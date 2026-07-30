import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";

type EastmoneyRow = Record<string, number | string | null | undefined>;
type CachedMarket = {
  source: "eastmoney";
  updatedAt: string;
  quoteAt?: string;
  marketSession?: "preopen" | "auction" | "continuous" | "lunch" | "closed";
  indices: unknown[];
  sectors: unknown[];
  scanCoverage: Record<string, unknown>;
};

const EASTMONEY_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Referer: "https://quote.eastmoney.com/",
  "User-Agent": "Mozilla/5.0 (compatible; MainlineRadar/1.0)",
};
const EASTMONEY_UT = "fa5fd1943c7b386f172d6893dbfba10b";
const EASTMONEY_HOSTS = [
  "https://48.push2.eastmoney.com",
  "https://92.push2.eastmoney.com",
  "https://20.push2.eastmoney.com",
  "https://82.push2.eastmoney.com",
  "https://push2.eastmoney.com",
];
// Board scans remain deduplicated, but a full-market ranking needs enough
// time to retry a temporarily slow official quote node before falling back to
// an old snapshot. The browser waits longer than this budget below.
const EASTMONEY_SCAN_BUDGET_MS = 12_000;
const EASTMONEY_ATTEMPT_TIMEOUT_MS = 4_000;
let preferredEastmoneyHost = EASTMONEY_HOSTS[0];
const PRIORITY_BOARD_IDS = new Set([
  "BK0490", // 军工概念
  "BK1204", // 国防军工
  "BK1229", // 地面兵装
  "BK1382", // 地面兵装三级
  "BK1036", // 半导体
  "BK0917", // 半导体概念
]);
const META_BOARD_NAME = /^(融资融券|沪股通|深股通|沪深股通|标普概念|富时罗素|MSCI中国|昨日涨停|昨日连板)$/;
const STYLE_BOARD_NAME = /^(微盘股|小盘股|中盘股|大盘股|低价股|高价股|百元股|超跌股|破发股|破净股|破增发价股|超级品牌|消费风格)$/;
const HOLDING_BOARD_NAME = /^(证金持股)$/;

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const isQualified = (sector: { score: number; flow: number; breadth: number; category?: string }) =>
  sector.category !== "持仓标签"
  && sector.score >= 65
  && sector.flow > 0
  && sector.breadth >= 50;
const cacheSchemaSql = `CREATE TABLE IF NOT EXISTS market_cache (
  cache_key TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
)`;

function marketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const date = `${read("year")}-${read("month")}-${read("day")}`;
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  const second = Number(read("second"));
  const minutes = hour * 60 + minute;
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(now);
  const tradingDay = !["Sat", "Sun"].includes(weekday);
  const isoAt = (h: number, m: number, s = 0) =>
    new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}+08:00`).toISOString();

  if (!tradingDay || minutes > 900) return { marketSession: "closed" as const, quoteAt: isoAt(15, 0) };
  if (minutes < 555) return { marketSession: "preopen" as const, quoteAt: now.toISOString() };
  if (minutes < 570) return { marketSession: "auction" as const, quoteAt: now.toISOString() };
  if (minutes <= 690) return { marketSession: "continuous" as const, quoteAt: now.toISOString() };
  if (minutes < 780) return { marketSession: "lunch" as const, quoteAt: isoAt(11, 30) };
  if (minutes <= 900) return { marketSession: "continuous" as const, quoteAt: now.toISOString() };
  return { marketSession: "closed" as const, quoteAt: isoAt(15, 0) };
}

async function readMarketCache() {
  try {
    await env.DB.prepare(cacheSchemaSql).run();
    let row = await env.DB.prepare(
      `SELECT updated_at, payload FROM market_cache WHERE cache_key = 'eastmoney-full'`
    ).first<{ updated_at: string; payload: string }>();
    if (!row) {
      row = await env.DB.prepare(
        `SELECT latest_captured_at AS updated_at, latest_payload AS payload
         FROM daily_snapshots
         WHERE COALESCE(json_extract(first_payload, '$.scanCoverage.fetchedBoards'), 0) >= 50
           AND COALESCE(json_extract(latest_payload, '$.scanCoverage.fetchedBoards'), 0) >= 50
         ORDER BY trade_date DESC LIMIT 1`
      ).first<{ updated_at: string; payload: string }>();
    }
    if (!row) return null;
    const parsed = JSON.parse(row.payload) as Partial<CachedMarket>;
    const payload: CachedMarket = {
      source: "eastmoney",
      updatedAt: parsed.updatedAt || row.updated_at,
      quoteAt: parsed.quoteAt,
      marketSession: parsed.marketSession,
      indices: parsed.indices ?? [],
      sectors: parsed.sectors ?? [],
      scanCoverage: parsed.scanCoverage ?? {},
    };
    // A historical row may be copied into the cache today while the quote
    // timestamp inside its payload is several sessions old. Freshness must be
    // measured from the quote itself, never from the database write time.
    const quoteTime = new Date(payload.updatedAt).getTime();
    const ageSeconds = Number.isFinite(quoteTime)
      ? Math.max(0, Math.floor((Date.now() - quoteTime) / 1000))
      : Number.MAX_SAFE_INTEGER;
    return { payload, ageSeconds };
  } catch {
    return null;
  }
}

async function writeMarketCache(payload: CachedMarket) {
  try {
    await env.DB.prepare(cacheSchemaSql).run();
    await env.DB.prepare(
      `INSERT INTO market_cache (cache_key, updated_at, payload)
       VALUES ('eastmoney-full', ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         updated_at = excluded.updated_at,
         payload = excluded.payload`
    ).bind(payload.updatedAt, JSON.stringify(payload)).run();
  } catch {
    // Cache failure must not block a valid live quote.
  }
}

function phase(score: number, change: number, flow: number, streak = 0) {
  if (score < 40 || (change < -2 && flow < 0)) return "退潮";
  if (change < 0 && flow > 0) return "分歧";
  if (streak >= 2 && score >= 80 && change > 1.5) return "加速";
  if (score >= 65 && flow > 0) return "启动";
  return "观察";
}

function normalizeSector(row: EastmoneyRow, index: number) {
  const change = number(row.f3);
  const flow = number(row.f62) / 100_000_000;
  const up = number(row.f104);
  const down = number(row.f105);
  const leaderChange = number(row.f136);
  const breadth = Math.round(clamp((up / Math.max(up + down, 1)) * 100));
  const flowScore = clamp(50 + Math.sign(flow) * Math.log10(Math.abs(flow) + 1) * 24);
  const momentumScore = clamp(50 + change * 7);
  const leaderScore = clamp(50 + leaderChange * 4);
  // The live structural score uses only fields returned by Eastmoney. Daily
  // continuity is a separate confirmation gate until enough valid snapshots
  // exist, so it must not be represented by an invented score component.
  const score = Math.round(clamp(flowScore * .38 + breadth * .27 + momentumScore * .22 + leaderScore * .13));
  const name = String(row.f14 || "未知板块");
  const category = STYLE_BOARD_NAME.test(name)
    ? "风格主线"
    : HOLDING_BOARD_NAME.test(name)
      ? "持仓标签"
      : "产业主线";
  const leader = String(row.f128 || "待识别");
  const currentPhase = category === "持仓标签" ? "观察" : phase(score, change, flow, 0);
  // Historical continuity must come from stored daily snapshots. Do not
  // manufacture a multi-day streak or trend from a single live quote.
  const trend = Array.from({ length: 7 }, () => score);

  return {
    id: String(row.f12 || `eastmoney-${index}`),
    name,
    category,
    code: String(row.f12 || "—"),
    score,
    phase: currentPhase,
    change,
    flow,
    streak: 0,
    // Eastmoney's board quote exposes the leading stock but not an exact
    // limit-up count. Keep only a conservative lower bound instead of
    // incorrectly reporting zero when the leader is visibly at the limit.
    limitUps: leaderChange >= 9.7 ? 1 : 0,
    breadth,
    leader,
    leaderChange,
    signal: `板块${change >= 0 ? "上涨" : "下跌"}${Math.abs(change).toFixed(2)}%，主力资金${flow >= 0 ? "净流入" : "净流出"}${Math.abs(flow).toFixed(2)}亿元，上涨家数占比${breadth}%。`,
    risk: currentPhase === "加速"
      ? "加速后需观察成交量与前排承接，放量滞涨将触发分歧预警。"
      : currentPhase === "启动"
        ? "当前属于启动确认区，若资金转负或龙头掉队，评分会快速下调。"
        : "尚未形成资金、强度与赚钱效应共振，暂按观察或风险方向处理。",
    trend,
    tags: [
      category,
      flow > 0 ? "资金流入" : flow < 0 ? "资金流出" : "资金待更新",
      breadth >= 60 ? "板块扩散" : "局部活跃",
      `东财实时`,
    ],
    stocks: [
      { name: leader, code: "领涨", role: "板块龙头", state: `${leaderChange >= 0 ? "+" : ""}${leaderChange.toFixed(2)}%` },
      { name, code: String(row.f12 || "—"), role: "板块指数", state: `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` },
      { name: "上涨 / 下跌", code: `${up} / ${down}`, role: "市场宽度", state: `${breadth}%` },
    ],
  };
}

type NormalizedSector = ReturnType<typeof normalizeSector>;

async function applyHistoricalContinuity(sectors: NormalizedSector[]) {
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  let history: { latest_payload: string }[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT latest_payload FROM daily_snapshots
       WHERE trade_date < ?
         AND COALESCE(json_extract(first_payload, '$.scanCoverage.fetchedBoards'), 0) >= 50
         AND COALESCE(json_extract(latest_payload, '$.scanCoverage.fetchedBoards'), 0) >= 50
       ORDER BY trade_date DESC LIMIT 6`
    ).bind(currentDate).all();
    history = (result.results ?? []) as { latest_payload: string }[];
  } catch {
    // History is optional for live quotes. A missing/empty D1 sample leaves
    // the current session as day one and never fabricates prior continuity.
  }

  const historicalSectors = history.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.latest_payload) as { sectors?: NormalizedSector[] };
      return [parsed.sectors ?? []];
    } catch {
      return [];
    }
  });

  return sectors.map((sector) => {
    let priorStreak = 0;
    const priorScores: number[] = [];
    if (isQualified(sector)) {
      for (const day of historicalSectors) {
        const prior = day.find((item) => item.id === sector.id);
        if (!prior || !isQualified(prior)) break;
        priorStreak += 1;
        priorScores.unshift(prior.score);
      }
    }
    const streak = isQualified(sector) ? priorStreak + 1 : 0;
    const scores = [...priorScores, sector.score].slice(-7);
    const trend = scores.length === 1 ? [scores[0], scores[0]] : scores;
    const currentPhase = sector.category === "持仓标签"
      ? "观察"
      : phase(sector.score, sector.change, sector.flow, streak);
    return {
      ...sector,
      streak,
      phase: currentPhase,
      trend,
      risk: currentPhase === "加速"
        ? "连续性已确认但进入加速区，需观察成交量与前排承接，放量滞涨将触发分歧预警。"
        : currentPhase === "启动"
          ? streak >= 2
            ? "连续性已初步确认；若资金转负或龙头掉队，阶段将快速下调。"
            : "当前仅为首日结构信号，下一有效交易日必须继续验证。"
          : sector.risk,
    };
  });
}

async function eastmoney(path: string) {
  // Four market dimensions are fetched in parallel below. Racing each one
  // across five hosts created too many simultaneous subrequests and abandoned
  // losing response bodies. Fallback hosts are therefore tried sequentially:
  // at most four upstream
  // responses remain in flight and every unusable body is explicitly closed.
  const deadline = Date.now() + EASTMONEY_SCAN_BUDGET_MS;
  const hosts = [
    preferredEastmoneyHost,
    ...EASTMONEY_HOSTS.filter((host) => host !== preferredEastmoneyHost),
  ];
  for (const host of hosts) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 250) break;
    try {
      const response = await fetch(`${host}${path}`, {
        headers: EASTMONEY_HEADERS,
        cf: { cacheTtl: 0 },
        signal: AbortSignal.timeout(Math.min(EASTMONEY_ATTEMPT_TIMEOUT_MS, remainingMs)),
      } as RequestInit & { cf: { cacheTtl: number } });
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      const payload = await response.json() as { data?: { diff?: EastmoneyRow[] } };
      if (!payload.data?.diff?.length) continue;
      preferredEastmoneyHost = host;
      return payload;
    } catch {
      // Try the next official quote node.
    }
  }
  throw new Error("Eastmoney unavailable on all quote nodes");
}

export async function GET() {
  const cached = await readMarketCache();
  if (cached && cached.ageSeconds < 55) {
    return NextResponse.json({
      ...cached.payload,
      cacheHit: true,
      dataAgeSeconds: cached.ageSeconds,
    }, {
      headers: {
        "Cache-Control": "private, max-age=5",
        "X-Data-Source": "Eastmoney-Cache",
      },
    });
  }

  try {
    const indexUrl = `/api/qt/ulist.np/get?fltt=2&invt=2&ut=${EASTMONEY_UT}&fields=f12%2Cf14%2Cf2%2Cf3%2Cf4%2Cf6&secids=1.000001%2C0.399001`;
    const boardFields = "f12%2Cf14%2Cf2%2Cf3%2Cf62%2Cf104%2Cf105%2Cf128%2Cf136";
    const conceptFlowUrl = `/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&ut=${EASTMONEY_UT}&fid=f62&fs=m%3A90%2Bt%3A3&fields=${boardFields}`;
    const industryFlowUrl = `/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&ut=${EASTMONEY_UT}&fid=f62&fs=m%3A90%2Bt%3A2&fields=${boardFields}`;
    const priorityUrl = `/api/qt/ulist.np/get?fltt=2&invt=2&ut=${EASTMONEY_UT}&fields=${boardFields}&secids=${[...PRIORITY_BOARD_IDS].map((id) => `90.${id}`).join("%2C")}`;
    const results = await Promise.allSettled([
      eastmoney(indexUrl),
      eastmoney(conceptFlowUrl),
      eastmoney(industryFlowUrl),
      eastmoney(priorityUrl),
    ]);
    const payloads = results.map((result) => result.status === "fulfilled" ? result.value : {});
    const [indexJson, ...boardPayloads] = payloads;
    const broadResults = results.slice(1, 3);
    const broadSourcesReady = broadResults.filter((result) => result.status === "fulfilled").length;

    const indices = (indexJson.data?.diff || []).map((row) => ({
      code: String(row.f12 || ""),
      name: String(row.f14 || ""),
      price: number(row.f2),
      change: number(row.f3),
      amount: number(row.f6),
    }));

    const rows = boardPayloads.flatMap((payload) => payload.data?.diff || []);
    const normalized = [...new Map(rows.map((row) => [String(row.f12), row])).values()]
      .map(normalizeSector)
      // Market-universe labels are useful filters in quote software but are
      // not investable industry/theme mainlines. Excluding them prevents a
      // huge constituent count from crowding out concentrated sector moves.
      .filter((sector) => !META_BOARD_NAME.test(sector.name));
    const ranked = (await applyHistoricalContinuity(normalized))
      // “结构分高”不等于“主线成立”。资金、扩散硬门槛必须先于
      // 分数排序，避免少数股暴涨或负流入板块占据主线首位。
      .sort((a, b) => {
        const qualificationGap = Number(isQualified(b)) - Number(isQualified(a));
        return qualificationGap || b.score - a.score;
      });
    const top = ranked.slice(0, 32);
    const retained = ranked.filter((sector) => PRIORITY_BOARD_IDS.has(sector.id) && !top.some((item) => item.id === sector.id));
    const unique = [...top, ...retained];

    // A successful priority-board request alone is not a market-wide scan.
    // Fail closed so six hand-picked boards can never masquerade as a complete
    // mainline ranking or be written into the historical audit sample.
    if (indices.length < 2 || broadSourcesReady < 2 || ranked.length < 50) {
      throw new Error(`Eastmoney scan incomplete: ${ranked.length} boards from ${broadSourcesReady}/2 broad universes`);
    }
    if (!unique.length) throw new Error("Eastmoney sector payload is empty");

    const marketState = marketClock();
    const responsePayload: CachedMarket = {
      source: "eastmoney",
      updatedAt: new Date().toISOString(),
      quoteAt: marketState.quoteAt,
      marketSession: marketState.marketSession,
      indices,
      sectors: unique,
      scanCoverage: {
        fetchedBoards: ranked.length,
        broadSourcesReady,
        broadSourcesExpected: 2,
        retainedPriorityBoards: retained.map((sector) => sector.id),
        dimensions: ["资金净流入", "板块涨幅"],
      },
    };
    await writeMarketCache(responsePayload);

    return NextResponse.json({
      ...responsePayload,
      cacheHit: false,
      dataAgeSeconds: 0,
    }, {
      headers: {
        "Cache-Control": "private, max-age=5",
        "X-Data-Source": "Eastmoney",
      },
    });
  } catch (error) {
    if (cached) {
      return NextResponse.json({
        ...cached.payload,
        source: "delayed" as const,
        cacheHit: true,
        dataAgeSeconds: cached.ageSeconds,
        error: error instanceof Error ? error.message : "Eastmoney unavailable",
      }, {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=10",
          "X-Data-Source": "Delayed-Cache",
        },
      });
    }
    return NextResponse.json({
      source: "fallback" as const,
      updatedAt: new Date().toISOString(),
      indices: [],
      sectors: [],
      error: error instanceof Error ? error.message : "Eastmoney unavailable",
    }, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Source": "Fallback",
      },
    });
  }
}
