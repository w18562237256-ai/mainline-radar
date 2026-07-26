import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import snapshot from "../../../public/market-data.json";
import { getLiveMarket } from "../../lib/live-market";

export const dynamic = "force-dynamic";

type LivePayload = Awaited<ReturnType<typeof getLiveMarket>>;

function captureWindow(observedAt: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(observedAt)).map((part) => [part.type, part.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes <= 10 * 60) return "open";
  if (minutes <= 11 * 60 + 30) return "morning";
  if (minutes < 14 * 60 + 30) return "afternoon";
  return "close";
}

async function persistSignals(payload: LivePayload) {
  if (!env.DB || !payload.isLive || payload.marketStatus !== "trading") return false;
  const window = captureWindow(payload.observedAt);
  const statements = payload.themes.map((theme) => {
    const leaderOne = theme.leaders[0];
    const leaderTwo = theme.leaders[1];
    const observedBucket = [
      payload.sessionDate,
      window,
      theme.phase,
      leaderOne?.code ?? "-",
      leaderTwo?.code ?? "-",
    ].join(":");
    return env.DB.prepare(`
      INSERT OR IGNORE INTO signal_observations (
        observed_at, observed_bucket, capture_window, session_date, source_mode,
        board_id, theme_name, phase, score,
        leader_one_code, leader_one_name, leader_one_change_bps,
        leader_two_code, leader_two_name, leader_two_change_bps, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      payload.observedAt,
      observedBucket,
      window,
      payload.sessionDate ?? "",
      payload.sourceMode,
      theme.id,
      theme.name,
      theme.phase,
      theme.score,
      leaderOne?.code ?? null,
      leaderOne?.name ?? null,
      leaderOne?.change == null ? null : Math.round(leaderOne.change * 100),
      leaderTwo?.code ?? null,
      leaderTwo?.name ?? null,
      leaderTwo?.change == null ? null : Math.round(leaderTwo.change * 100),
      JSON.stringify({
        change: theme.change,
        netIn: theme.netIn,
        breadth: theme.breadth,
        leaders: theme.leaders,
        components: theme.components,
        historyValid: theme.historyValid,
        attributionStatus: theme.attributionStatus,
      }),
    );
  });
  if (statements.length) await env.DB.batch(statements);
  return true;
}

function historicalReplay() {
  return {
    ...structuredClone(snapshot),
    schemaVersion: 3,
    dataRevision: "historical-replay-2026-07-24",
    isLive: false,
    sourceMode: "historical_replay",
    observedAt: null,
    sourceLabel: "7月24日历史复盘快照",
    market: {
      ...snapshot.market,
      mainlineCount: 0,
      conclusion: "实时行情暂不可用 · 当前仅展示历史复盘",
    },
    themes: snapshot.themes.map((theme) => ({
      ...theme,
      confirmed: false,
      leaderMode: "gainers",
      action: "历史复盘，不作为盘中预测；等待实时扫描恢复",
    })),
    methodology: {
      ...snapshot.methodology,
      name: "历史复盘模式",
      rule: "该快照包含事后人工校正，只用于解释历史盘面，不参与前向命中率统计。",
    },
  };
}

export async function GET() {
  try {
    const payload = await getLiveMarket();
    const signalLedger = payload.marketStatus === "closed"
      ? "market_closed" as const
      : await persistSignals(payload)
        .then((saved) => saved ? "append_only" as const : "unavailable" as const)
        .catch(() => "unavailable" as const);
    return NextResponse.json({ ...payload, signalLedger }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "CDN-Cache-Control": "no-store",
        "X-Market-Mode": "live_scan",
      },
    });
  } catch {
    return NextResponse.json(historicalReplay(), {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "CDN-Cache-Control": "no-store",
        "X-Market-Mode": "historical_replay",
      },
    });
  }
}
