import { mkdir, writeFile } from "node:fs/promises";

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const scale = (value, low, high) => clamp(((value - low) / (high - low)) * 100);

async function fetchFirst(urls) {
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0 MainlineRadarBot/2.0" },
        signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      const json = JSON.parse(await response.text());
      if (!json?.data) throw new Error(`empty ${url}`);
      return json;
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
  const fields = "f12,f14,f3,f24,f62,f104,f105,f109,f184";
  const query = `pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m%3A90%2Bt%3A${type}%2Bf%3A!50&fields=${fields}`;
  const hosts = ["7.push2.eastmoney.com", "82.push2.eastmoney.com", "56.push2.eastmoney.com", "push2.eastmoney.com"];
  const json = await fetchFirst(hosts.map((host) => `https://${host}/api/qt/clist/get?${query}`));
  return (json.data.diff ?? []).map((quote) => ({ ...quote, boardType }));
}

async function getAllBoards() {
  const groups = await Promise.allSettled([
    getBoardGroup("2", "行业板块"),
    getBoardGroup("3", "概念板块"),
  ]);
  const boards = groups.flatMap((group) => group.status === "fulfilled" ? group.value : []);
  const unique = new Map();
  for (const board of boards) if (board.f12 && board.f14) unique.set(board.f12, board);
  return [...unique.values()];
}

async function getHistory(code) {
  const query = `secid=90.${code}&klt=101&fqt=1&lmt=30&end=20500101&fields1=f1%2Cf2%2Cf3&fields2=f51%2Cf52%2Cf53%2Cf54%2Cf55%2Cf56%2Cf57%2Cf58%2Cf59%2Cf60%2Cf61`;
  const json = await fetchFirst([
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?${query}`,
    `http://push2his.eastmoney.com/api/qt/stock/kline/get?${query}`,
  ]);
  return (json.data.klines ?? []).map((line) => {
    const [date, , close, , , , amount, , pct] = line.split(",");
    return { date, close: Number(close), amount: Number(amount), pct: Number(pct) };
  }).filter((row) => row.date && Number.isFinite(row.close));
}

async function getLeaders(code) {
  const query = `pn=1&pz=60&po=1&np=1&fltt=2&invt=2&fid=f6&fs=b%3A${code}&fields=f14%2Cf3%2Cf6%2Cf109`;
  const json = await fetchFirst([
    `https://7.push2.eastmoney.com/api/qt/clist/get?${query}`,
    `https://82.push2.eastmoney.com/api/qt/clist/get?${query}`,
    `https://push2.eastmoney.com/api/qt/clist/get?${query}`,
  ]);
  const stocks = (json.data.diff ?? []).filter((stock) => stock.f14 && !stock.f14.includes("退"));
  const maxAmount = Math.max(...stocks.map((stock) => Number(stock.f6 ?? 0)), 1);
  return stocks.map((stock) => ({
    name: stock.f14,
    score: scale(Number(stock.f109 ?? stock.f3 ?? 0), -5, 20) * .45
      + scale(Number(stock.f3 ?? 0), -3, 10) * .25
      + (Number(stock.f6 ?? 0) / maxAmount) * 30,
  })).sort((a, b) => b.score - a.score).slice(0, 2)
    .map((stock, index) => ({ rank: index ? "龙二" : "龙一", name: stock.name }));
}

function periodReturn(history, sessions) {
  const latest = history.at(-1)?.close;
  const base = history[Math.max(0, history.length - 1 - sessions)]?.close;
  return latest && base ? ((latest / base) - 1) * 100 : 0;
}

function strength(score) {
  return score >= 70 ? "较强" : score >= 58 ? "观察" : "偏弱";
}

function selectCandidates(boards) {
  const ranked = (selector, count = 18) => [...boards]
    .filter((board) => Number.isFinite(selector(board)))
    .sort((a, b) => selector(b) - selector(a))
    .slice(0, count);
  const breadth = (board) => {
    const up = Number(board.f104 ?? 0);
    const down = Number(board.f105 ?? 0);
    return up + down ? up / (up + down) : .5;
  };
  const preliminary = (board) =>
    scale(Number(board.f3 ?? 0), -2, 7) * .28
    + scale(Number(board.f109 ?? 0), -5, 20) * .25
    + scale(Number(board.f24 ?? 0), -10, 45) * .19
    + breadth(board) * 16
    + scale(Number(board.f184 ?? 0), -8, 12) * .12;

  const union = new Map();
  [
    ...ranked((board) => Number(board.f3 ?? -99)),
    ...ranked((board) => Number(board.f109 ?? -99)),
    ...ranked((board) => Number(board.f24 ?? -99)),
    ...ranked((board) => Number(board.f62 ?? -Infinity)),
    ...ranked(preliminary, 28),
  ].forEach((board) => union.set(board.f12, board));
  return [...union.values()].sort((a, b) => preliminary(b) - preliminary(a)).slice(0, 60);
}

function genericInsight(board) {
  return {
    catalyst: `${board.boardType}近期涨幅、扩散度和资金强度共同进入全市场前列`,
    risk: "短期强度回落、上涨家数明显收缩，且龙头股无法完成分歧承接",
  };
}

const allBoards = await getAllBoards();
if (!allBoards.length) throw new Error("No A-share boards returned");
const candidates = selectCandidates(allBoards);
const historyResults = await mapLimit(candidates, 6, async (quote) => {
  const history = await getHistory(quote.f12);
  if (history.length < 5) throw new Error(`history missing ${quote.f14}`);
  const up = Number(quote.f104 ?? 0);
  const down = Number(quote.f105 ?? 0);
  const breadth = up + down ? up / (up + down) : .5;
  const day = Number(quote.f3 ?? 0);
  const fiveDay = periodReturn(history, 5);
  const twentyDay = periodReturn(history, 20);
  const positive5 = history.slice(-5).filter((row) => row.pct > 0).length;
  const positive20 = history.slice(-20).filter((row) => row.pct > 0).length;
  const dayScore = Math.round(scale(day, -2, 7) * .45 + breadth * 30 + scale(Number(quote.f184 ?? 0), -8, 12) * .25);
  const currentScore = Math.round(scale(fiveDay, -5, 18) * .48 + (positive5 / 5) * 22 + dayScore * .3);
  const midScore = Math.round(scale(twentyDay, -10, 35) * .55 + (positive20 / 20) * 20 + currentScore * .25);
  return {
    id: String(quote.f12), name: quote.f14, matchedBoard: quote.f14, boardType: quote.boardType,
    scores: { day: dayScore, current: currentScore, mid: midScore },
    returns: { day, fiveDay, twentyDay }, breadth,
    netIn: Number(quote.f62 ?? 0) / 100_000_000,
    leaders: [], ...genericInsight(quote), sessionDate: history.at(-1).date,
  };
});

const analyzed = historyResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
if (!analyzed.length) throw new Error("No candidate history resolved");
const topBy = (period, count = 15) => [...analyzed].sort((a, b) => b.scores[period] - a.scores[period]).slice(0, count);
const finalistsMap = new Map();
[...topBy("day"), ...topBy("current"), ...topBy("mid")].forEach((theme) => finalistsMap.set(theme.id, theme));
const finalists = [...finalistsMap.values()];

const leaderResults = await mapLimit(finalists, 5, async (theme) => ({ id: theme.id, leaders: await getLeaders(theme.id) }));
const leadersById = new Map(leaderResults.flatMap((result) => result.status === "fulfilled" ? [[result.value.id, result.value.leaders]] : []));
const themes = finalists.map((theme) => ({ ...theme, leaders: leadersById.get(theme.id) ?? [] }));
const pick = (period) => [...themes].sort((a, b) => b.scores[period] - a.scores[period])[0];
const top = { day: pick("day"), current: pick("current"), mid: pick("mid") };

const payload = {
  available: true,
  sourceLabel: "GitHub全市场自动扫描",
  sessionDate: themes.map((theme) => theme.sessionDate).sort().at(-1),
  updatedAt: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }).format(new Date()),
  coverage: { totalBoards: allBoards.length, deepAnalyzed: analyzed.length, displayed: themes.length },
  leaders: Object.fromEntries(Object.entries(top).map(([period, theme]) => [period, {
    id: theme.id, name: theme.name, score: theme.scores[period], strength: strength(theme.scores[period]),
  }])),
  themes: themes.sort((a, b) => b.scores.current - a.scores.current),
  method: `已快速扫描${allBoards.length}个A股行业与概念板块；对涨幅、资金或阶段强度靠前的${analyzed.length}个候选进行历史深算，再分别生成1日、5日和20日榜单。`,
};

await Promise.all([mkdir("public", { recursive: true }), mkdir("docs", { recursive: true })]);
const output = JSON.stringify(payload, null, 2) + "\n";
await Promise.all([writeFile("public/market-data.json", output), writeFile("docs/market-data.json", output)]);
console.log(`Updated ${payload.sessionDate}: ${allBoards.length} scanned, ${analyzed.length} analyzed, ${themes.length} displayed`);
