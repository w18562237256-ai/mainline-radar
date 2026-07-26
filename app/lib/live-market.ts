const OVERVIEW_URL = "https://www.lwwhy.com/trading/sector";
const REQUIRED_COVERAGE_BOARDS = ["BK0457"];
const USER_AGENT = "Mozilla/5.0 MainlineRadar/4.0";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const scale = (value: number, low: number, high: number) =>
  clamp(((value - low) / Math.max(high - low, 0.0001)) * 100);

type OverviewBoard = {
  id: string;
  name: string;
  change: number;
  netIn: number;
};

type Constituent = {
  code: string;
  name: string;
  change: number;
  amount: number;
  constituentVerified: true;
  consecutiveBoards?: number;
  catalyst?: string;
  catalystSourceDate?: string;
};

function parseMoney(raw: string) {
  const value = Number(raw.replace(/[^\d.+-]/g, ""));
  if (!Number.isFinite(value)) return 0;
  if (raw.includes("亿")) return value;
  if (raw.includes("万")) return value / 10_000;
  return value / 100_000_000;
}

async function fetchText(url: string, timeout = 10_000) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeout),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

export function parseSectorOverview(html: string): OverviewBoard[] {
  const pattern = /href="https:\/\/quote\.eastmoney\.com\/bk\/90\.(BK\d{4})\.html"[^>]*>BK\d{4}<\/a>\s*<a[^>]*href="\/trading\/sector\/\1"[^>]*>([^<]+)<\/a>\s*<span data-percent[^>]*>\s*([-+]?\d+(?:\.\d+)?)%<\/span>\s*<span[^>]*>([-+]?[^<]+)<\/span>/g;
  const boards = [...html.matchAll(pattern)].map((match) => ({
    id: match[1],
    name: match[2].trim(),
    change: Number(match[3]),
    netIn: parseMoney(match[4]),
  }));
  return [...new Map(boards.map((board) => [board.id, board])).values()];
}

export function parseConstituents(html: string): Constituent[] {
  const pattern = /quote\.eastmoney\.com\/(?:sh|sz|bj)(\d{6})\.html[^"]*"[^>]*>\1<\/a>\s*<a[^>]*>([^<]+)<\/a>\s*<span data-percent[^>]*>\s*([-+]?\d+(?:\.\d+)?)%<\/span>\s*<span data-amount[^>]*>\s*([^<]+)<\/span>/g;
  return [...html.matchAll(pattern)].map((match) => ({
    code: match[1],
    name: match[2].trim(),
    change: Number(match[3]),
    amount: parseMoney(match[4]),
    constituentVerified: true,
  }));
}

function parseBoardDetail(html: string, board: OverviewBoard) {
  const summary = html.match(/<div class="text-lg">[\s\S]*?<span[^>]*>\s*([-+]?\d+(?:\.\d+)?)%\s*<\/span>[\s\S]*?<span[^>]*>\s*([-+]?\d+(?:\.\d+)?(?:亿|万))\s*<\/span>/);
  const breadth = html.match(/上涨\s*<span[^>]*>(\d+)<\/span>家[\s\S]*?下跌\s*<span[^>]*>(\d+)<\/span>家[\s\S]*?总计\s*<span>(\d+)<\/span>家/);
  const up = Number(breadth?.[1] ?? 0);
  const down = Number(breadth?.[2] ?? 0);
  const total = Number(breadth?.[3] ?? up + down);
  return {
    ...board,
    change: Number(summary?.[1] ?? board.change),
    netIn: summary?.[2] ? parseMoney(summary[2]) : board.netIn,
    sessionDate: html.match(/>(\d{4}-\d{2}-\d{2})<\/a>/)?.[1] ?? null,
    breadth: total ? up / total : 0,
    up,
    down,
    total,
    constituents: parseConstituents(html),
  };
}

function marketPrefix(code: string) {
  if (code.startsWith("6")) return "SH";
  if (code.startsWith("8") || code.startsWith("4")) return "BJ";
  return "SZ";
}

export function parseStockCatalyst(html: string) {
  const date = html.match(/最新异动解析[\s\S]*?\((\d{4}-\d{2}-\d{2})\)/)?.[1];
  const time = html.match(/异动时间:<\/span>\s*([0-9:]+)/)?.[1];
  const ladder = html.match(/连板:<\/span>[\s\S]*?>(\d+)天(\d+)板<\/span>/);
  const catalyst = html.match(/AI 精简<\/p>[\s\S]*?<p class="font-medium">([^<]+)<\/p>/)?.[1]?.trim();
  return {
    catalyst,
    sourceDate: date,
    sourceTime: time,
    consecutiveBoards: Number(ladder?.[2] ?? 0),
  };
}

async function enrichConstituent(stock: Constituent) {
  try {
    const html = await fetchText(
      `https://www.lwwhy.com/stock/detail/${marketPrefix(stock.code)}${stock.code}`,
      7_000,
    );
    const parsed = parseStockCatalyst(html);
    return {
      ...stock,
      consecutiveBoards: parsed.consecutiveBoards,
      catalyst: parsed.catalyst,
      catalystSourceDate: parsed.sourceDate,
    };
  } catch {
    return stock;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index]);
    }
  }));
  return output;
}

async function getHistory(boardId: string) {
  const params = new URLSearchParams({
    secid: `90.${boardId}`,
    klt: "101",
    fqt: "1",
    lmt: "30",
    end: "20500101",
    fields1: "f1,f2,f3",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  });
  for (const protocol of ["https", "http"]) {
    try {
      const response = await fetch(`${protocol}://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`, {
        headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      const payload = await response.json() as { data?: { klines?: string[] } };
      const rows = (payload.data?.klines ?? []).map((line) => {
        const [date, , close, , , , , , pct] = line.split(",");
        return { date, close: Number(close), pct: Number(pct) };
      }).filter((row) => row.date && Number.isFinite(row.close) && Number.isFinite(row.pct));
      if (rows.length >= 6) return rows;
    } catch {
      // Try the alternate protocol.
    }
  }
  return [];
}

export function historyMetrics(rows: { date: string; close: number; pct: number }[]) {
  if (rows.length < 6) {
    return { valid: false, fiveDay: 0, twentyDay: 0, positiveDays5: 0 };
  }
  const latest = rows.at(-1)!.close;
  const fiveBase = rows.at(-6)!.close;
  const twentyBase = rows[Math.max(0, rows.length - 21)].close;
  const fiveDay = ((latest / fiveBase) - 1) * 100;
  const twentyDay = ((latest / twentyBase) - 1) * 100;
  const positiveDays5 = rows.slice(-5).filter((row) => row.pct > 0).length;
  const consistent = !(fiveDay > 0.05 && positiveDays5 === 0);
  return { valid: consistent, fiveDay, twentyDay, positiveDays5 };
}

function phaseFor(input: {
  score: number;
  change: number;
  breadth: number;
  continuity: number;
  leaderCount: number;
  historyValid: boolean;
}) {
  if (input.change <= -1.2 || input.breadth < 0.25) return "退潮";
  if (
    input.historyValid
    && input.score >= 72
    && input.continuity >= 50
    && input.leaderCount >= 2
  ) return "加速";
  if (input.score >= 62 && input.breadth >= 0.5 && input.leaderCount >= 2) return "启动";
  return "观察";
}

export async function getLiveMarket() {
  const overviewHtml = await fetchText(OVERVIEW_URL, 12_000);
  const overview = parseSectorOverview(overviewHtml);
  if (overview.length < 100) throw new Error("sector overview incomplete");

  const byId = new Map(overview.map((board) => [board.id, board]));
  for (const id of REQUIRED_COVERAGE_BOARDS) {
    if (!byId.has(id)) byId.set(id, { id, name: id === "BK0457" ? "电网设备" : id, change: 0, netIn: 0 });
  }
  const allBoards = [...byId.values()];
  const rankedSeeds = [...allBoards]
    .sort((a, b) => (b.change * 3 + Math.max(b.netIn, 0)) - (a.change * 3 + Math.max(a.netIn, 0)))
    .slice(0, 10);
  for (const id of REQUIRED_COVERAGE_BOARDS) {
    const required = byId.get(id);
    if (required && !rankedSeeds.some((board) => board.id === id)) rankedSeeds.push(required);
  }

  const detailResults = await mapLimit(rankedSeeds, 8, async (board) => {
    try {
      const html = await fetchText(`https://www.lwwhy.com/trading/sector/${board.id}`, 9_000);
      const detail = parseBoardDetail(html, board);
      if (!detail.constituents.length) throw new Error(`no constituents ${board.id}`);
      return detail;
    } catch {
      return null;
    }
  });
  const details = detailResults.filter((detail): detail is NonNullable<typeof detail> => detail != null);
  if (details.length < 3) throw new Error("insufficient live board details");
  const enrichedDetails = await mapLimit(details, 8, async (detail) => {
    const [leaders, historyRows] = await Promise.all([
      mapLimit(detail.constituents.slice(0, 4), 4, enrichConstituent),
      getHistory(detail.id),
    ]);
    return { ...detail, leaders, history: historyMetrics(historyRows) };
  });

  const netValues = enrichedDetails.map((board) => board.netIn);
  const themes = enrichedDetails.map((board) => {
    const ordered = [...board.leaders].sort((a, b) =>
      (Number(b.consecutiveBoards ?? 0) * 100 + b.change * 2 + b.amount)
      - (Number(a.consecutiveBoards ?? 0) * 100 + a.change * 2 + a.amount)
    );
    const verifiedLeaders = ordered.filter((leader) => Number(leader.consecutiveBoards ?? 0) > 0).slice(0, 2);
    const capitalRank = netValues.filter((value) => value <= board.netIn).length / netValues.length * 100;
    const components = {
      capital: Math.round(capitalRank),
      strength: Math.round(scale(board.change, -2, 6)),
      breadth: Math.round(board.breadth * 100),
      continuity: board.history.valid
        ? Math.round(scale(board.history.fiveDay, -4, 15) * 0.7 + board.history.positiveDays5 / 5 * 30)
        : 0,
      leadership: Math.round(clamp(
        verifiedLeaders.length * 25
        + Math.max(...verifiedLeaders.map((leader) => Number(leader.consecutiveBoards ?? 0)), 0) * 12.5,
      )),
    };
    const score = Math.round(
      components.capital * 0.25
      + components.strength * 0.25
      + components.breadth * 0.2
      + components.continuity * 0.15
      + components.leadership * 0.15,
    );
    const phase = phaseFor({
      score,
      change: board.change,
      breadth: board.breadth,
      continuity: components.continuity,
      leaderCount: verifiedLeaders.length,
      historyValid: board.history.valid,
    });
    const leaders = verifiedLeaders.map((leader, index) => ({
      rank: index ? "龙二" : "龙一",
      code: leader.code,
      name: leader.name,
      change: leader.change,
      consecutiveBoards: leader.consecutiveBoards,
      constituentVerified: true,
      themeRelationVerified: false,
      catalyst: leader.catalyst,
    }));
    const driver = leaders[0]?.catalyst
      ? `领涨股异动解析：${leaders[0].catalyst}`
      : "仅由行情触发，题材原因尚未自动核验";
    return {
      id: board.id,
      name: board.name,
      rawName: board.name,
      matchedBoard: board.name,
      boardType: "行业板块",
      sessionDate: board.sessionDate
        ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()),
      score,
      phase,
      confirmed: phase === "启动" || phase === "加速",
      change: board.change,
      netIn: board.netIn,
      mainNetRatio: 0,
      breadth: board.breadth,
      leaderName: leaders[0]?.name ?? ordered[0]?.name ?? null,
      leaderChange: leaders[0]?.change ?? ordered[0]?.change ?? 0,
      trend: {
        fiveDay: board.history.fiveDay,
        twentyDay: board.history.twentyDay,
        positiveDays5: board.history.positiveDays5,
        valid: board.history.valid,
      },
      components,
      leaders,
      displayType: "行情候选",
      driver,
      attribution: "成分归属已从板块明细核验；题材逻辑尚未核验，不与成分关系混用",
      attributionStatus: leaders[0]?.catalyst ? "machine_extracted" : "unverified",
      leaderMode: leaders.length >= 2 ? "dragon" : "gainers",
      signal: leaders.length >= 2
        ? `检测到${leaders.map((leader) => `${leader.name}${leader.consecutiveBoards}板`).join("、")}；${board.up}涨${board.down}跌`
        : `尚未形成两只可验证的连板梯队；${board.up}涨${board.down}跌`,
      action: "候选主线已触发，等待下一交易日扩散、资金承接和龙头分歧确认",
      risk: "仅为前向监测信号；若扩散收缩、资金转负或龙头断板，则候选失效",
      historyValid: board.history.valid,
    };
  }).sort((a, b) => b.score - a.score).slice(0, 14);

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const sessionDate = themes.map((theme) => theme.sessionDate).sort().at(-1) ?? null;
  const marketStatus = sessionDate === today ? "trading" : "closed";
  return {
    schemaVersion: 3,
    dataRevision: `live-${now.toISOString()}`,
    available: true,
    isLive: true,
    marketStatus,
    sourceMode: "live_scan",
    sourceLabel: "免费行情源实时扫描",
    observedAt: now.toISOString(),
    sessionDate,
    updatedAt: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(now),
    coverage: {
      totalBoards: allBoards.length,
      deepAnalyzed: details.length,
      displayed: themes.length,
      requiredBoardsChecked: REQUIRED_COVERAGE_BOARDS,
    },
    market: {
      temperature: Math.round(themes.slice(0, 5).reduce((sum, theme) => sum + theme.score, 0) / 5),
      mainlineCount: themes.filter((theme) => theme.confirmed).length,
      conclusion: marketStatus === "trading"
        ? "前向监测中 · 仅输出候选，不输出买入结论"
        : "市场休市 · 展示最近交易日扫描结果",
      strongestThemeId: themes[0]?.id ?? null,
      nextThemeId: themes[1]?.id ?? null,
    },
    themes,
    methodology: {
      name: "前向监测模型 V4",
      weights: { capital: 25, strength: 25, breadth: 20, continuity: 15, leadership: 15 },
      rule: "实时扫描全量行业板块和重点缺口板块；成分关系、题材归因分别标记；历史数据异常时持续性不计分；所有信号按时间追加留档。",
    },
  };
}
