import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get("limit") ?? 30);
  const limit = Math.min(100, Math.max(1, Number.isFinite(requested) ? requested : 30));
  try {
    const result = await env.DB.prepare(`
      SELECT
        id, observed_at AS observedAt, capture_window AS captureWindow, session_date AS sessionDate,
        source_mode AS sourceMode, board_id AS boardId, theme_name AS themeName,
        phase, score, leader_one_code AS leaderOneCode,
        leader_one_name AS leaderOneName, leader_one_change_bps AS leaderOneChangeBps,
        leader_two_code AS leaderTwoCode, leader_two_name AS leaderTwoName,
        leader_two_change_bps AS leaderTwoChangeBps
      FROM signal_observations
      ORDER BY observed_at DESC, score DESC
      LIMIT ?
    `).bind(limit).all();
    return NextResponse.json({
      available: true,
      appendOnly: true,
      records: result.results ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({
      available: false,
      appendOnly: true,
      records: [],
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
