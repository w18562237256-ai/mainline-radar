import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type EastMoneyBoard = {
  f12?: string;
  f14?: string;
  f3?: number;
  f62?: number;
  f184?: number;
  f104?: number;
  f105?: number;
};

const fallbackBoards = [
  { code: "BK1117", name: "兵装重组", score: 88, change: 6.8, netIn: 31.6, breadth: .82, up: 18, down: 4, persistence: 2, leaders: ["长城军工", "建设工业", "湖南天雁"], tag: "强势扩散" },
  { code: "BK0490", name: "军工装备", score: 82, change: 3.9, netIn: 42.3, breadth: .73, up: 96, down: 35, persistence: 2, leaders: ["长城军工", "超卓航科", "内蒙一机"], tag: "逆势增强" },
  { code: "BK0891", name: "中船系", score: 76, change: 3.2, netIn: 14.7, breadth: .71, up: 12, down: 5, persistence: 2, leaders: ["中船特气", "中船汉光", "久之洋"], tag: "分支助攻" },
  { code: "BK1036", name: "半导体设备", score: 73, change: 1.8, netIn: 24.1, breadth: .61, up: 41, down: 26, persistence: 1, leaders: ["中微公司", "北方华创", "拓荆科技"], tag: "资金回流" },
  { code: "BK0969", name: "商业航天", score: 68, change: 1.6, netIn: 11.8, breadth: .58, up: 49, down: 35, persistence: 1, leaders: ["航天电子", "中国卫星", "中科星图"], tag: "趋势观察" },
  { code: "BK1126", name: "军工电子", score: 65, change: 1.4, netIn: 9.6, breadth: .57, up: 32, down: 24, persistence: 1, leaders: ["高德红外", "国博电子", "振华科技"], tag: "内部扩散" },
  { code: "BK0816", name: "CPO", score: 58, change: -.7, netIn: 6.3, breadth: .43, up: 18, down: 24, persistence: 0, leaders: ["中际旭创", "新易盛", "天孚通信"], tag: "高位分歧" },
  { code: "BK0428", name: "电力", score: 45, change: -3.8, netIn: -38.5, breadth: .16, up: 15, down: 79, persistence: 0, leaders: ["华电国际", "国电电力", "长江电力"], tag: "资金退潮" },
];

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function classify(score: number) {
  if (score >= 80) return "主线确认";
  if (score >= 68) return "主线候选";
  if (score >= 55) return "轮动观察";
  return "强度不足";
}

function mapBoard(board: EastMoneyBoard) {
  const change = Number(board.f3 ?? 0);
  const up = Number(board.f104 ?? 0);
  const down = Number(board.f105 ?? 0);
  const breadth = up + down > 0 ? up / (up + down) : .5;
  const netIn = Number(board.f62 ?? 0) / 100_000_000;
  const moneyRatio = Number(board.f184 ?? 0);
  const score = Math.round(clamp(38 + change * 4.2 + breadth * 24 + moneyRatio * .65 + Math.sign(netIn) * Math.min(Math.abs(netIn), 12) * .7));
  return {
    code: board.f12 ?? "unknown",
    name: board.f14 ?? "未命名板块",
    score,
    change,
    netIn,
    breadth,
    up,
    down,
    persistence: change > 2.5 ? 1 : 0,
    leaders: ["实时成分股待展开"],
    tag: classify(score),
  };
}

export async function GET() {
  const params = new URLSearchParams({
    pn: "1",
    pz: "30",
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: "f3",
    fs: "m:90+t:2",
    fields: "f12,f14,f3,f62,f184,f104,f105",
  });

  try {
    const response = await fetch(`https://push2.eastmoney.com/api/qt/clist/get?${params}`, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0 MainlineRadar/1.0",
      },
      signal: AbortSignal.timeout(5500),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Upstream ${response.status}`);
    const json = await response.json() as { data?: { diff?: EastMoneyBoard[] } };
    const boards = json.data?.diff?.map(mapBoard).sort((a, b) => b.score - a.score);
    if (!boards?.length) throw new Error("Empty upstream payload");

    return NextResponse.json({
      source: "eastmoney",
      sourceLabel: "东方财富公开行情",
      asOf: new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date()),
      marketState: boards[0].score >= 80 ? "主线形成期" : "轮动识别期",
      boards,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({
      source: "snapshot",
      sourceLabel: "7月24日收盘快照",
      asOf: "2026-07-24 15:00",
      marketState: "弱市抱团 · 主线孕育",
      boards: fallbackBoards,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
