import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type BoardQuote = {
  f12?: string;
  f14?: string;
  f3?: number;
  f62?: number;
  f104?: number;
  f105?: number;
  f184?: number;
};

type StockQuote = {
  f14?: string;
  f3?: number;
  f6?: number;
  f109?: number;
};

const watchPool = [
  {
    id: "ai-hardware", name: "AI硬件",
    aliases: ["CPO概念", "光通信模块", "PCB", "算力概念"],
    fallbackLeaders: ["中际旭创", "新易盛"],
    catalyst: "海外AI资本开支、订单与业绩兑现",
    risk: "容量核心连续破位，硬件分支长期没有回流",
  },
  {
    id: "semiconductor", name: "半导体国产替代",
    aliases: ["半导体", "存储芯片", "光刻机", "先进封装"],
    fallbackLeaders: ["北方华创", "中微公司"],
    catalyst: "设备材料自主可控、存储景气修复",
    risk: "设备核心走弱，存储和材料无法形成扩散",
  },
  {
    id: "military", name: "军工／兵装重组",
    aliases: ["军工", "军民融合", "兵装重组"],
    fallbackLeaders: ["长城军工", "建设工业"],
    catalyst: "兵装重组预期与弱市资金抱团",
    risk: "高辨识度个股走弱，容量军工股不跟随",
  },
  {
    id: "power-grid", name: "电网设备",
    aliases: ["电网设备", "智能电网", "特高压"],
    fallbackLeaders: ["中国西电", "双杰电气"],
    catalyst: "国网招标与电网投资预期",
    risk: "招标催化后快速退潮，容量中军不再新高",
  },
  {
    id: "commercial-space", name: "商业航天",
    aliases: ["商业航天", "卫星导航"],
    fallbackLeaders: ["中国卫星", "中国卫通"],
    catalyst: "低轨卫星与卫星互联网预期",
    risk: "事件刺激仍无法带动容量核心",
  },
  {
    id: "innovative-drug", name: "创新药",
    aliases: ["创新药", "生物医药"],
    fallbackLeaders: ["恒瑞医药", "三生国健"],
    catalyst: "超跌修复与产业事件催化",
    risk: "板块反弹不延续，核心股无法穿越轮动",
  },
  {
    id: "vc-additive", name: "VC添加剂涨价",
    aliases: ["锂电池", "化工原料"],
    fallbackLeaders: ["孚日股份", "日科化学"],
    catalyst: "产品报价上涨与供给收缩预期",
    risk: "报价不能被订单验证，先锋断板后没有补涨",
  },
];

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function scale(value: number, low: number, high: number) {
  return clamp(((value - low) / (high - low)) * 100);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0 MainlineRadar/3.0",
    },
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json() as Promise<T>;
}

async function getBoards() {
  const params = new URLSearchParams({
    pn: "1", pz: "500", po: "1", np: "1", fltt: "2", invt: "2",
    fid: "f3", fs: "m:90+t:2", fields: "f12,f14,f3,f62,f104,f105,f184",
  });
  const json = await fetchJson<{ data?: { diff?: BoardQuote[] } }>(
    `https://push2.eastmoney.com/api/qt/clist/get?${params}`,
  );
  return json.data?.diff ?? [];
}

async function getHistory(code: string) {
  const params = new URLSearchParams({
    secid: `90.${code}`, klt: "101", fqt: "1", lmt: "30", end: "20500101",
    fields1: "f1,f2,f3", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  });
  const json = await fetchJson<{ data?: { klines?: string[] } }>(
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
  );
  return (json.data?.klines ?? []).map((line) => {
    const [date, , close, , , , amount, , pct] = line.split(",");
    return { date, close: Number(close), amount: Number(amount), pct: Number(pct) };
  }).filter((item) => item.date && Number.isFinite(item.close));
}

async function getLeaders(code: string, fallback: string[]) {
  try {
    const params = new URLSearchParams({
      pn: "1", pz: "50", po: "1", np: "1", fltt: "2", invt: "2",
      fid: "f6", fs: `b:${code}`, fields: "f14,f3,f6,f109",
    });
    const json = await fetchJson<{ data?: { diff?: StockQuote[] } }>(
      `https://push2.eastmoney.com/api/qt/clist/get?${params}`,
    );
    const stocks = (json.data?.diff ?? [])
      .filter((stock) => stock.f14 && !String(stock.f14).includes("退"))
      .map((stock) => ({
        name: String(stock.f14),
        day: Number(stock.f3 ?? 0),
        fiveDay: Number(stock.f109 ?? stock.f3 ?? 0),
        amount: Number(stock.f6 ?? 0),
      }));
    const maxAmount = Math.max(...stocks.map((stock) => stock.amount), 1);
    return stocks
      .map((stock) => ({
        ...stock,
        leaderScore: scale(stock.fiveDay, -5, 20) * .45
          + scale(stock.day, -3, 10) * .25
          + (stock.amount / maxAmount) * 30,
      }))
      .sort((a, b) => b.leaderScore - a.leaderScore)
      .slice(0, 2)
      .map((stock) => stock.name)
      .concat(fallback)
      .filter((name, index, array) => array.indexOf(name) === index)
      .slice(0, 2);
  } catch {
    return fallback;
  }
}

function periodReturn(history: { close: number }[], sessions: number) {
  if (history.length < 2) return 0;
  const latest = history.at(-1)!.close;
  const base = history[Math.max(0, history.length - 1 - sessions)].close;
  return base ? ((latest / base) - 1) * 100 : 0;
}

function confidence(score: number) {
  if (score >= 70) return "较强";
  if (score >= 58) return "观察";
  return "偏弱";
}

export async function GET() {
  try {
    const boards = await getBoards();
    if (!boards.length) throw new Error("empty market data");

    const matched = watchPool.map((theme) => {
      const candidates = boards.filter((board) =>
        theme.aliases.some((alias) => board.f14?.includes(alias) || alias.includes(board.f14 ?? "—")),
      );
      const quote = candidates.sort((a, b) => Number(b.f3 ?? -99) - Number(a.f3 ?? -99))[0];
      return { theme, quote };
    }).filter((item) => item.quote?.f12);

    const resolved = await Promise.allSettled(matched.map(async ({ theme, quote }) => {
      const [history, leaders] = await Promise.all([
        getHistory(String(quote.f12)),
        getLeaders(String(quote.f12), theme.fallbackLeaders),
      ]);
      if (history.length < 5) throw new Error(`insufficient history for ${theme.id}`);
      const up = Number(quote.f104 ?? 0);
      const down = Number(quote.f105 ?? 0);
      const breadth = up + down ? up / (up + down) : .5;
      const day = Number(quote.f3 ?? 0);
      const moneyRatio = Number(quote.f184 ?? 0);
      const return5 = periodReturn(history, 5);
      const return20 = periodReturn(history, 20);
      const positive5 = history.slice(-5).filter((item) => item.pct > 0).length;
      const positive20 = history.slice(-20).filter((item) => item.pct > 0).length;

      const dayScore = Math.round(
        scale(day, -2, 7) * .45 + breadth * 30 + scale(moneyRatio, -8, 12) * .25,
      );
      const currentScore = Math.round(
        scale(return5, -5, 18) * .48 + (positive5 / 5) * 22 + dayScore * .3,
      );
      const midScore = Math.round(
        scale(return20, -10, 35) * .55 + (positive20 / 20) * 20 + currentScore * .25,
      );

      return {
        id: theme.id,
        name: theme.name,
        matchedBoard: quote.f14,
        scores: { day: dayScore, current: currentScore, mid: midScore },
        returns: { day, fiveDay: return5, twentyDay: return20 },
        breadth,
        netIn: Number(quote.f62 ?? 0) / 100_000_000,
        leaders: leaders.map((name, index) => ({ rank: index === 0 ? "龙一" : "龙二", name })),
        catalyst: theme.catalyst,
        risk: theme.risk,
        sessionDate: history.at(-1)?.date ?? "",
      };
    }));
    const themes = resolved.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);

    if (!themes.length) throw new Error("no matched themes");
    const pick = (period: "day" | "current" | "mid") =>
      [...themes].sort((a, b) => b.scores[period] - a.scores[period])[0];
    const leaders = {
      day: pick("day"),
      current: pick("current"),
      mid: pick("mid"),
    };
    const sessionDate = themes.map((theme) => theme.sessionDate).sort().at(-1) ?? "";

    return NextResponse.json({
      available: true,
      sourceLabel: "东方财富公开行情",
      sessionDate,
      updatedAt: new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit",
      }).format(new Date()),
      leaders: {
        day: { id: leaders.day.id, name: leaders.day.name, score: leaders.day.scores.day, strength: confidence(leaders.day.scores.day) },
        current: { id: leaders.current.id, name: leaders.current.name, score: leaders.current.scores.current, strength: confidence(leaders.current.scores.current) },
        mid: { id: leaders.mid.id, name: leaders.mid.name, score: leaders.mid.scores.mid, strength: confidence(leaders.mid.scores.mid) },
      },
      themes: themes.sort((a, b) => b.scores.current - a.scores.current),
      method: "今日看当日涨幅、上涨家数和资金强度；近5日看累计表现与上涨天数；中期看近20日趋势。三个周期分别排名。",
    }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" } });
  } catch {
    return NextResponse.json({
      available: false,
      sourceLabel: "行情数据暂时未连接",
      sessionDate: null,
      updatedAt: null,
      leaders: null,
      themes: [],
      method: "数据源中断时暂停判断，不使用旧结论冒充实时结果。",
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
