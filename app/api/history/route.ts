import { env } from "cloudflare:workers";

type Sector = {
  id: string;
  name: string;
  category?: string;
  score: number;
  phase: string;
  leader: string;
  leaderChange: number;
  flow: number;
  breadth: number;
};

const isQualified = (sector: Sector) =>
  sector.category !== "持仓标签"
  && sector.score >= 65
  && sector.flow > 0
  && sector.breadth >= 50;

type SnapshotPayload = {
  source: string;
  updatedAt: string;
  quoteAt?: string;
  marketSession?: "preopen" | "auction" | "continuous" | "lunch" | "closed";
  session?: "auction" | "continuous";
  sectors: Sector[];
  scanCoverage?: {
    fetchedBoards?: number;
    broadSourcesReady?: number;
    broadSourcesExpected?: number;
  };
};

const schemaSql = `CREATE TABLE IF NOT EXISTS daily_snapshots (
  trade_date TEXT PRIMARY KEY,
  first_captured_at TEXT NOT NULL,
  first_payload TEXT NOT NULL,
  latest_captured_at TEXT NOT NULL,
  latest_payload TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 1
)`;

function shanghaiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

async function ensureSchema() {
  if (!env.DB) throw new Error("D1 binding unavailable");
  await env.DB.prepare(schemaSql).run();
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    if (date) {
      const row = await env.DB.prepare(
        `SELECT trade_date, first_captured_at, first_payload, latest_captured_at,
          latest_payload, sample_count FROM daily_snapshots
          WHERE trade_date = ?
            AND COALESCE(json_extract(first_payload, '$.scanCoverage.fetchedBoards'), 0) >= 50
            AND COALESCE(json_extract(latest_payload, '$.scanCoverage.fetchedBoards'), 0) >= 50`
      ).bind(date).first();
      return Response.json({ snapshot: row ?? null }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const { results } = await env.DB.prepare(
      `SELECT trade_date, first_captured_at, latest_captured_at, sample_count,
        json_extract(first_payload, '$.sectors[0].name') AS first_mainline,
        json_extract(first_payload, '$.sectors[0].leader') AS first_leader,
        json_extract(first_payload, '$.sectors[0].score') AS first_score,
        json_extract(latest_payload, '$.sectors[0].name') AS latest_mainline,
        json_extract(latest_payload, '$.sectors[0].leader') AS latest_leader,
        json_extract(latest_payload, '$.sectors[0].score') AS latest_score
       FROM daily_snapshots
       WHERE COALESCE(json_extract(first_payload, '$.scanCoverage.fetchedBoards'), 0) >= 50
         AND COALESCE(json_extract(latest_payload, '$.scanCoverage.fetchedBoards'), 0) >= 50
       ORDER BY trade_date DESC LIMIT 30`
    ).all();
    return Response.json({ dates: results ?? [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ dates: [], storageReady: false }, { status: 200 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as SnapshotPayload;
    const completeScan = (payload.scanCoverage?.fetchedBoards ?? 0) >= 50
      && (payload.scanCoverage?.broadSourcesReady ?? 0) >= 2;
    const validSession = payload.marketSession === "auction" || payload.marketSession === "continuous";
    if (payload.source !== "eastmoney" || !payload.updatedAt || !payload.sectors?.length || !completeScan || !validSession) {
      return Response.json({ error: "Only complete live Eastmoney scans are stored" }, { status: 400 });
    }
    await ensureSchema();
    const quoteAt = payload.quoteAt || payload.updatedAt;
    const tradeDate = shanghaiDate(quoteAt);
    const capturedAt = new Date(quoteAt).toISOString();
    const orderedSectors = [
      ...payload.sectors.filter(isQualified),
      ...payload.sectors.filter((sector) => !isQualified(sector)),
    ];
    const body = JSON.stringify({
      source: payload.source,
      updatedAt: capturedAt,
      session: payload.session ?? "continuous",
      sectors: orderedSectors.slice(0, 12),
      scanCoverage: payload.scanCoverage,
    });
    await env.DB.prepare(
      `INSERT INTO daily_snapshots
        (trade_date, first_captured_at, first_payload, latest_captured_at, latest_payload, sample_count)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(trade_date) DO UPDATE SET
        first_captured_at = CASE
          WHEN COALESCE(json_extract(daily_snapshots.first_payload, '$.scanCoverage.fetchedBoards'), 0) < 50
            OR COALESCE(json_extract(daily_snapshots.first_payload, '$.sectors[0].score'), 0) < 65
            OR COALESCE(json_extract(daily_snapshots.first_payload, '$.sectors[0].flow'), 0) <= 0
            OR COALESCE(json_extract(daily_snapshots.first_payload, '$.sectors[0].breadth'), 0) < 50
          THEN excluded.first_captured_at ELSE daily_snapshots.first_captured_at END,
        first_payload = CASE
          WHEN COALESCE(json_extract(daily_snapshots.first_payload, '$.scanCoverage.fetchedBoards'), 0) < 50
            OR COALESCE(json_extract(daily_snapshots.first_payload, '$.sectors[0].score'), 0) < 65
            OR COALESCE(json_extract(daily_snapshots.first_payload, '$.sectors[0].flow'), 0) <= 0
            OR COALESCE(json_extract(daily_snapshots.first_payload, '$.sectors[0].breadth'), 0) < 50
          THEN excluded.first_payload ELSE daily_snapshots.first_payload END,
        latest_captured_at = excluded.latest_captured_at,
        latest_payload = excluded.latest_payload,
        sample_count = daily_snapshots.sample_count + 1`
    ).bind(tradeDate, capturedAt, body, capturedAt, body).run();
    return Response.json({ saved: true, tradeDate });
  } catch {
    return Response.json({ error: "Snapshot storage unavailable" }, { status: 503 });
  }
}
