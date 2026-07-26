import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type EastMoneyBoard = {
  f14?: string;
  f3?: number;
  f62?: number;
  f104?: number;
  f105?: number;
};

const researchThemes = [
  {
    id: "ai-hardware",
    name: "AI硬件",
    stage: "中期主线",
    status: "confirmed",
    score: 84,
    confidence: "高",
    duration: "4—7月",
    catalyst: "海外AI资本开支、订单与业绩兑现",
    leaders: { capacity: ["中际旭创", "新易盛"], trend: ["胜宏科技", "沪电股份"], emotion: ["光迅科技"] },
    components: { continuity: 19, capacity: 15, breadth: 15, capital: 13, catalyst: 9, resilience: 13 },
    invalidation: "容量核心连续破位，硬件各分支两周无有效回流",
    aliases: ["CPO概念", "光通信模块", "PCB", "算力概念"],
  },
  {
    id: "semiconductor",
    name: "半导体国产替代",
    stage: "回流候选",
    status: "candidate",
    score: 78,
    confidence: "中高",
    duration: "5—7月",
    catalyst: "设备材料自主可控、存储景气修复",
    leaders: { capacity: ["北方华创", "中微公司"], trend: ["兆易创新", "北京君正"], emotion: ["沃格光电"] },
    components: { continuity: 15, capacity: 15, breadth: 14, capital: 12, catalyst: 10, resilience: 12 },
    invalidation: "设备双核心放量走弱，存储与材料无法形成扩散",
    aliases: ["半导体", "存储芯片", "光刻机", "先进封装"],
  },
  {
    id: "military",
    name: "军工／兵装重组",
    stage: "新主线候选",
    status: "candidate",
    score: 69,
    confidence: "中",
    duration: "7月下旬",
    catalyst: "兵装重组预期、弱市抱团",
    leaders: { capacity: ["航天电子", "中国卫星"], trend: ["建设工业", "中光学"], emotion: ["长城军工"] },
    components: { continuity: 8, capacity: 11, breadth: 13, capital: 11, catalyst: 9, resilience: 17 },
    invalidation: "长城军工分歧后无承接，容量股与军工电子不跟随",
    aliases: ["军工", "军民融合", "商业航天"],
  },
  {
    id: "power-grid",
    name: "电网设备",
    stage: "阶段轮动",
    status: "rotation",
    score: 63,
    confidence: "中",
    duration: "7月下旬",
    catalyst: "国网招标与电网投资预期",
    leaders: { capacity: ["中国西电", "平高电气"], trend: ["双杰电气"], emotion: ["和顺电气"] },
    components: { continuity: 7, capacity: 12, breadth: 12, capital: 10, catalyst: 9, resilience: 13 },
    invalidation: "招标催化后次日即退潮，容量中军不再新高",
    aliases: ["电网设备", "智能电网", "特高压"],
  },
  {
    id: "commercial-space",
    name: "商业航天",
    stage: "前主线观察",
    status: "watch",
    score: 60,
    confidence: "中低",
    duration: "1月主升／7月观察",
    catalyst: "低轨卫星与卫星互联网预期",
    leaders: { capacity: ["中国卫星", "中国卫通"], trend: ["航天电子"], emotion: ["航天发展"] },
    components: { continuity: 8, capacity: 12, breadth: 9, capital: 8, catalyst: 9, resilience: 14 },
    invalidation: "事件刺激仍无法带动容量核心，反弹仅限小票",
    aliases: ["商业航天", "卫星导航"],
  },
  {
    id: "innovative-drug",
    name: "创新药",
    stage: "高低切轮动",
    status: "rotation",
    score: 57,
    confidence: "中低",
    duration: "7月",
    catalyst: "超跌修复、产业事件催化",
    leaders: { capacity: ["恒瑞医药", "百济神州"], trend: ["三生国健"], emotion: ["舒泰神"] },
    components: { continuity: 7, capacity: 11, breadth: 10, capital: 8, catalyst: 8, resilience: 13 },
    invalidation: "创新药指数反弹不延续，核心个股无法穿越轮动",
    aliases: ["创新药", "生物医药"],
  },
  {
    id: "vc-additive",
    name: "VC添加剂涨价",
    stage: "题材试错",
    status: "watch",
    score: 51,
    confidence: "低",
    duration: "7月下旬",
    catalyst: "产品报价上涨与供给收缩预期",
    leaders: { capacity: ["华盛锂电"], trend: ["日科化学"], emotion: ["孚日股份"] },
    components: { continuity: 5, capacity: 5, breadth: 8, capital: 7, catalyst: 9, resilience: 17 },
    invalidation: "报价不能被订单验证，孚日股份断板后无补涨梯队",
    aliases: ["锂电池", "化工原料"],
  },
];

async function getLiveBoards() {
  const params = new URLSearchParams({
    pn: "1", pz: "100", po: "1", np: "1", fltt: "2", invt: "2",
    fid: "f3", fs: "m:90+t:2", fields: "f14,f3,f62,f104,f105",
  });
  const response = await fetch(`https://push2.eastmoney.com/api/qt/clist/get?${params}`, {
    headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0 MainlineRadar/2.0" },
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("upstream unavailable");
  const json = await response.json() as { data?: { diff?: EastMoneyBoard[] } };
  return json.data?.diff ?? [];
}

export async function GET() {
  let liveBoards: EastMoneyBoard[] = [];
  let live = false;
  try {
    liveBoards = await getLiveBoards();
    live = liveBoards.length > 0;
  } catch {
    live = false;
  }

  const themes = researchThemes.map((theme) => {
    const matches = liveBoards.filter((board) =>
      theme.aliases.some((alias) => board.f14?.includes(alias) || alias.includes(board.f14 ?? "—"))
    );
    const best = matches.sort((a, b) => Number(b.f3 ?? -99) - Number(a.f3 ?? -99))[0];
    const up = Number(best?.f104 ?? 0);
    const down = Number(best?.f105 ?? 0);
    return {
      ...theme,
      live: best ? {
        board: best.f14,
        change: Number(best.f3 ?? 0),
        netIn: Number(best.f62 ?? 0) / 100_000_000,
        breadth: up + down ? up / (up + down) : null,
      } : null,
    };
  });

  return NextResponse.json({
    live,
    sourceLabel: live ? "东方财富公开行情＋研究模型" : "2026-07-24研究快照",
    asOf: live
      ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date())
      : "2026-07-24 15:00",
    researchAsOf: "2026-07-24收盘",
    regime: "AI硬科技仍是中期主线；7月处于高位验证与低位试错期",
    themes,
    rotation: [
      { period: "1月", title: "商业航天＋AI应用", note: "阶段双主线，题材情绪占优" },
      { period: "2—3月", title: "资源／机器人／存储试错", note: "从应用预期向硬件兑现迁移" },
      { period: "4—6月", title: "AI硬件主升", note: "CPO→PCB→存储→设备材料" },
      { period: "7月", title: "高低切与新主线竞争", note: "半导体回流；电网、军工、涨价线试错" },
    ],
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
