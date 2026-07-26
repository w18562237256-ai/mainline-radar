import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SNAPSHOT_URL =
  "https://raw.githubusercontent.com/w18562237256-ai/mainline-radar/main/public/market-data.json";

export async function GET() {
  try {
    const response = await fetch(SNAPSHOT_URL, {
      signal: AbortSignal.timeout(6_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`snapshot ${response.status}`);
    const payload = await response.json() as { schemaVersion?: number };
    if (payload.schemaVersion !== 2) throw new Error("unsupported snapshot schema");
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=120" },
    });
  } catch {
    return NextResponse.json({
      schemaVersion: 2,
      available: false,
      sourceLabel: "行情数据暂时未连接",
      sessionDate: null,
      updatedAt: null,
      coverage: { totalBoards: 0, deepAnalyzed: 0, displayed: 0 },
      market: {
        temperature: 0,
        mainlineCount: 0,
        conclusion: "数据中断 · 暂停判断",
        strongestThemeId: null,
        nextThemeId: null,
      },
      themes: [],
      methodology: {
        name: "主线共振模型 V2",
        weights: { capital: 30, strength: 25, breadth: 20, continuity: 15, leadership: 10 },
        rule: "数据不足时不输出主线结论。",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
