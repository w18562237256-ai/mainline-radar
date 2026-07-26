import { mkdir, readFile, writeFile } from "node:fs/promises";

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const scale = (value, low, high) => clamp(((value - low) / (high - low)) * 100);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const NON_THEME_BOARD = /昨日|首板|连板|涨停|打板|新高|新低|触板|炸板|破净|融资融券|沪股通|深股通|标普|MSCI|富时罗素|机构重仓|基金重仓|社保重仓|QFII/;
const previousLeadersById = new Map();
try {
  const previous = JSON.parse(await readFile("public/market-data.json", "utf8"));
  for (const theme of previous.themes ?? []) {
    if ((theme.leaders?.length ?? 0) >= 2) previousLeadersById.set(theme.id, theme.leaders);
  }
} catch {
  // A first run has no previous verified snapshot to preserve.
}

async function fetchFirst(urls) {
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          Referer: "https://quote.eastmoney.com/",
          "User-Agent": "Mozilla/5.0 MainlineRadar/5.0",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      const payload = await response.json();
      if (!payload?.data) throw new Error(`empty ${url}`);
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function getBoardGroup(type, boardType) {
  const fields = "f12,f14,f3,f24,f62,f104,f105,f109,f128,f136,f184";
  const hosts = ["17.push2.eastmoney.com", "79.push2.eastmoney.com", "29.push2.eastmoney.com", "7.push2.eastmoney.com", "82.push2.eastmoney.com", "push2.eastmoney.com"];
  const rows = [];
  for (let page = 1; page <= 8; page += 1) {
    const params = new URLSearchParams({
      pn: String(page), pz: "100", po: "1", np: "1",
      ut: "bd1d9ddb04089700cf9c27f6f7426281",
      fltt: "2", invt: "2", fid: "f3",
      fs: `m:90 t:${type} f:!50`, fields,
    });
    const payload = await fetchFirst(hosts.map((host) => `https://${host}/api/qt/clist/get?${params}`));
    const pageRows = payload.data.diff ?? [];
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
    await wait(180);
  }
  return rows.map((quote) => ({ ...quote, boardType }));
}

async function getAllBoards() {
  const groups = await Promise.allSettled([
    getBoardGroup("2", "行业板块"),
    getBoardGroup("3", "概念板块"),
  ]);
  const boards = groups.flatMap((group) => group.status === "fulfilled" ? group.value : []);
  const unique = new Map();
  for (const board of boards) {
    if (board.f12 && board.f14 && !NON_THEME_BOARD.test(board.f14)) unique.set(board.f12, board);
  }
  return [...unique.values()];
}

async function getHistory(code) {
  const params = new URLSearchParams({
    secid: `90.${code}`, klt: "101", fqt: "1", lmt: "30", end: "20500101",
    fields1: "f1,f2,f3", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  });
  const payload = await fetchFirst([
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
    `http://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
  ]);
  return (payload.data.klines ?? []).map((line) => {
    const [date, , close, , , , amount, , pct] = line.split(",");
    return { date, close: Number(close), amount: Number(amount), pct: Number(pct) };
  }).filter((row) => row.date && Number.isFinite(row.close));
}

async function getLeaders(code) {
  const params = new URLSearchParams({
    pn: "1", pz: "100", po: "1", np: "1",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: "2", invt: "2", fid: "f3",
    fs: `b:${code} f:!50`, fields: "f12,f14,f3,f6,f109",
  });
  const payload = await fetchFirst([
    `https://29.push2.eastmoney.com/api/qt/clist/get?${params}`,
    `https://17.push2.eastmoney.com/api/qt/clist/get?${params}`,
    `https://79.push2.eastmoney.com/api/qt/clist/get?${params}`,
    `https://push2.eastmoney.com/api/qt/clist/get?${params}`,
  ]);
  const stocks = (payload.data.diff ?? []).filter((stock) => stock.f14 && !stock.f14.includes("退"));
  const maxAmount = Math.max(...stocks.map((stock) => Number(stock.f6 ?? 0)), 1);
  return stocks.map((stock) => ({
    code: stock.f12,
    name: stock.f14,
    change: Number(stock.f3 ?? 0),
    momentum5d: Number(stock.f109 ?? stock.f3 ?? 0),
    amount: Number(stock.f6 ?? 0),
    score: scale(Number(stock.f109 ?? stock.f3 ?? 0), -5, 20) * .45
      + scale(Number(stock.f3 ?? 0), -3, 10) * .25
      + (Number(stock.f6 ?? 0) / maxAmount) * 30,
  })).sort((a, b) => b.score - a.score).slice(0, 2)
    .map((stock, index) => ({
      rank: index ? "龙二" : "龙一",
      code: stock.code,
      name: stock.name,
      change: stock.change,
      momentum5d: stock.momentum5d,
      amount: stock.amount,
      constituentVerified: true,
    }));
}

function periodReturn(history, sessions) {
  const latest = history.at(-1)?.close;
  const base = history[Math.max(0, history.length - 1 - sessions)]?.close;
  return latest && base ? ((latest / base) - 1) * 100 : 0;
}

function percentile(value, values) {
  if (!values.length) return 0;
  return values.filter((item) => item <= value).length / values.length * 100;
}

function selectCandidates(boards) {
  const ranked = (selector, count = 24) => [...boards]
    .filter((board) => Number.isFinite(selector(board)))
    .sort((a, b) => selector(b) - selector(a))
    .slice(0, count);
  const union = new Map();
  [
    ...ranked((board) => Number(board.f3 ?? -99)),
    ...ranked((board) => Number(board.f62 ?? -Infinity)),
    ...ranked((board) => Number(board.f184 ?? -99)),
    ...ranked((board) => Number(board.f136 ?? -99)),
    ...ranked((board) => Number(board.f109 ?? -99)),
  ].forEach((board) => union.set(board.f12, board));
  return [...union.values()].slice(0, 90);
}

function phaseFor(theme) {
  if (
    theme.change <= -1.2
    || theme.breadth < .3
    || (theme.components.capital < 30 && theme.netIn < 0)
  ) return "退潮";
  if (
    theme.score >= 70
    && theme.components.continuity >= 45
    && theme.leaderAvgChange >= 7
    && theme.trend.fiveDay >= 5
  ) return "加速";
  if (
    theme.score >= 62
    && theme.components.capital >= 50
    && theme.breadth >= .5
    && theme.change >= .5
  ) return "启动";
  return "观察";
}

function scoreFromComponents(components) {
  return Math.round(
    components.capital * .3
    + components.strength * .25
    + components.breadth * .2
    + components.continuity * .15
    + components.leadership * .1,
  );
}

function signalFor(theme) {
  const leaderText = theme.leaders.length >= 2
    ? `${theme.leaders[0].name}、${theme.leaders[1].name}形成龙头梯队`
    : "龙头梯队尚未完整核验";
  if (theme.phase === "加速") {
    return `${leaderText}，核心平均涨幅${theme.leaderAvgChange.toFixed(1)}%，近5日板块涨幅${theme.trend.fiveDay.toFixed(1)}%；核心加速，仍需观察扩散`;
  }
  if (theme.phase === "启动") {
    return `${leaderText}，资金、当日强度开始共振；持续性分${theme.components.continuity}，尚未达到加速标准`;
  }
  if (theme.phase === "退潮") {
    return `板块涨幅、资金或上涨家数转弱，当前不具备主线进攻条件`;
  }
  return `资金分${theme.components.capital}、强度分${theme.components.strength}、扩散分${theme.components.breadth}，尚未同时满足主线条件`;
}

function actionFor(phase) {
  if (phase === "加速") return "强度已高，不盲目追涨，等分歧后的承接";
  if (phase === "启动") return "加入重点观察，确认下一次刷新仍有资金承接";
  if (phase === "退潮") return "降低关注，等待资金和上涨家数重新恢复";
  return "暂不下结论，等待资金、扩散和龙头形成共振";
}

const allBoards = await getAllBoards();
if (!allBoards.length) throw new Error("No A-share boards returned");
const candidates = selectCandidates(allBoards);

const historyResults = await mapLimit(candidates, 5, async (quote) => {
  const history = await getHistory(quote.f12);
  if (history.length < 5) throw new Error(`history missing ${quote.f14}`);
  const up = Number(quote.f104 ?? 0);
  const down = Number(quote.f105 ?? 0);
  return {
    id: String(quote.f12),
    rawName: quote.f14,
    matchedBoard: quote.f14,
    boardType: quote.boardType,
    sessionDate: history.at(-1).date,
    change: Number(quote.f3 ?? 0),
    netIn: Number(quote.f62 ?? 0) / 100_000_000,
    mainNetRatio: Number(quote.f184 ?? 0),
    breadth: up + down ? up / (up + down) : .5,
    leaderName: quote.f128 && quote.f128 !== "-" ? quote.f128 : null,
    leaderChange: Number(quote.f136 ?? 0),
    trend: {
      fiveDay: periodReturn(history, 5),
      twentyDay: periodReturn(history, 20),
      positiveDays5: history.slice(-5).filter((row) => row.pct > 0).length,
    },
  };
});

const resolved = historyResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
if (!resolved.length) throw new Error("No candidate history resolved");
const netValues = resolved.map((theme) => theme.netIn);

const scored = resolved.map((theme) => {
  const components = {
    capital: Math.round(
      percentile(theme.netIn, netValues) * .6 + scale(theme.mainNetRatio, -8, 12) * .4,
    ),
    strength: Math.round(
      scale(theme.change, -2, 6) * .6 + scale(theme.trend.fiveDay, -4, 15) * .4,
    ),
    breadth: Math.round(theme.breadth * 100),
    continuity: Math.round(
      scale(theme.trend.fiveDay, -4, 15) * .5
      + (theme.trend.positiveDays5 / 5) * 30
      + scale(theme.trend.twentyDay, -10, 30) * .2,
    ),
    leadership: Math.round(
      (theme.leaderName ? 30 : 0) + scale(theme.leaderChange, -2, 10) * .7,
    ),
  };
  const score = scoreFromComponents(components);
  const base = { ...theme, name: theme.rawName, components, score };
  const phase = phaseFor(base);
  const confirmed = score >= 65 && phase !== "退潮" && components.capital >= 45 && components.breadth >= 40;
  return {
    ...base,
    phase,
    confirmed,
    leaders: theme.leaderName ? [{
      rank: "龙一",
      name: theme.leaderName,
      change: theme.leaderChange,
      constituentVerified: true,
    }] : [],
    signal: `资金分${components.capital}、强度分${components.strength}、扩散分${components.breadth}、持续分${components.continuity}、龙头分${components.leadership}`,
    action: actionFor(phase),
    risk: "资金转为持续流出、上涨家数明显收缩，或龙头跌破承接时，该判断失效",
  };
});

const finalists = scored.sort((a, b) => b.score - a.score).slice(0, 30);
await wait(8_000);
const leaderResults = await mapLimit(finalists, 2, async (theme) => {
  const preserved = previousLeadersById.get(theme.id);
  try {
    const leaders = await getLeaders(theme.id);
    return {
      id: theme.id,
      leaders: leaders.length >= 2 ? leaders : preserved ?? (leaders.length ? leaders : theme.leaders),
    };
  } catch {
    return { id: theme.id, leaders: preserved ?? theme.leaders };
  }
});
const leadersById = new Map(leaderResults.flatMap((result) =>
  result.status === "fulfilled" ? [[result.value.id, result.value.leaders]] : [],
));
const themes = finalists.map((theme) => {
  const leaders = leadersById.get(theme.id) ?? theme.leaders;
  const leaderAvgChange = leaders.length
    ? leaders.reduce((sum, leader) => sum + Number(leader.change ?? 0), 0) / leaders.length
    : Number(theme.leaderChange ?? 0);
  const leaderMomentum = Math.max(...leaders.map((leader) => Number(leader.momentum5d ?? leader.change ?? 0)), 0);
  const components = {
    ...theme.components,
    leadership: Math.round(clamp(
      (leaders.length >= 2 ? 30 : leaders.length ? 15 : 0)
      + scale(leaderAvgChange, -2, 10) * .45
      + scale(leaderMomentum, -5, 25) * .25,
    )),
  };
  const score = scoreFromComponents(components);
  const base = { ...theme, leaders, leaderAvgChange, components, score };
  const phase = phaseFor(base);
  const confirmed = score >= 65 && phase !== "退潮" && components.capital >= 45 && components.breadth >= 40;
  const result = { ...base, phase, confirmed };
  return {
    ...result,
    displayType: confirmed ? "主线题材" : "行业板块",
    driver: "行情源只提供行业归属，需再与当天催化交叉核验",
    attribution: "未完成题材归因前，只能视为行业板块表现",
    leaderMode: confirmed && (phase === "启动" || phase === "加速") ? "dragon" : "gainers",
    signal: signalFor(result),
    action: actionFor(phase),
    risk: phase === "加速"
      ? "龙一、龙二同时转弱且上涨家数未继续扩散时，加速信号失效"
      : "资金转为持续流出、上涨家数明显收缩，或龙头跌破承接时，该判断失效",
  };
}).sort((a, b) => b.score - a.score);
const topFive = themes.slice(0, 5);
const temperature = Math.round(topFive.reduce((sum, theme) => sum + theme.score, 0) / Math.max(topFive.length, 1));
const mainlineCount = themes.filter((theme) => theme.confirmed).length;
const conclusion = mainlineCount >= 3
  ? "主线清晰 · 资金聚焦"
  : mainlineCount >= 1
    ? "弱市聚焦 · 主线待扩散"
    : "快速轮动 · 暂无确认主线";

const payload = {
  schemaVersion: 2,
  available: true,
  sourceLabel: "东方财富全市场快照",
  sessionDate: themes.map((theme) => theme.sessionDate).sort().at(-1),
  updatedAt: new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit",
  }).format(new Date()),
  coverage: {
    totalBoards: allBoards.length,
    deepAnalyzed: resolved.length,
    displayed: themes.length,
  },
  market: {
    temperature,
    mainlineCount,
    conclusion,
    strongestThemeId: themes[0]?.id ?? null,
    nextThemeId: themes.find((theme, index) => index > 0 && theme.phase === "启动")?.id ?? themes[1]?.id ?? null,
  },
  themes,
  methodology: {
    name: "主线归因模型 V3",
    weights: { capital: 30, strength: 25, breadth: 20, continuity: 15, leadership: 10 },
    rule: "先区分静态行业归属与当天上涨题材，再用资金、强度、上涨扩散、持续性和龙头梯队五项共振判断阶段；观察和退潮板块只标领涨股。",
  },
};

await mkdir("public", { recursive: true });
await mkdir("docs", { recursive: true });
const output = `${JSON.stringify(payload, null, 2)}\n`;
await writeFile("public/market-data.json", output, "utf8");
await writeFile("docs/market-data.json", output, "utf8");
console.log(JSON.stringify({
  sessionDate: payload.sessionDate,
  totalBoards: payload.coverage.totalBoards,
  analyzed: payload.coverage.deepAnalyzed,
  displayed: payload.coverage.displayed,
  conclusion,
  top: themes.slice(0, 5).map((theme) => `${theme.name}:${theme.score}:${theme.phase}`),
}, null, 2));
