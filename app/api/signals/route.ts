import { env } from "cloudflare:workers";

const schemaSql = `CREATE TABLE IF NOT EXISTS signal_events (
  event_key TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  sector_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL
)`;

type SignalInput = {
  eventKey: string;
  tradeDate: string;
  triggeredAt: string;
  signalType: "early" | "add" | "recovery";
  stockCode: string;
  stockName: string;
  sectorName: string;
  score: number;
  summary: string;
  payload?: unknown;
};

async function ensureSchema() {
  if (!env.DB) throw new Error("D1 binding unavailable");
  await env.DB.prepare(schemaSql).run();
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const query = date
      ? env.DB.prepare(`SELECT event_key, trade_date, triggered_at, signal_type, stock_code,
          stock_name, sector_name, score, summary FROM signal_events
          WHERE trade_date = ? ORDER BY triggered_at DESC LIMIT 50`).bind(date)
      : env.DB.prepare(`SELECT event_key, trade_date, triggered_at, signal_type, stock_code,
          stock_name, sector_name, score, summary FROM signal_events
          ORDER BY triggered_at DESC LIMIT 50`);
    const { results } = await query.all();
    return Response.json({ events: results ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ events: [], storageReady: false });
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as SignalInput;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate)
      || !/^\d{6}$/.test(input.stockCode)
      || !["early", "add", "recovery"].includes(input.signalType)
      || !input.eventKey?.startsWith(`${input.tradeDate}:`)
      || !input.stockName?.trim()
      || !input.sectorName?.trim()
      || !input.summary?.trim()
      || !Number.isFinite(input.score)
      || input.score < 0
      || input.score > 100
    ) {
      return Response.json({ error: "Invalid signal event" }, { status: 400 });
    }
    await ensureSchema();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO signal_events
        (event_key, trade_date, triggered_at, signal_type, stock_code, stock_name,
         sector_name, score, summary, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      input.eventKey.slice(0, 160),
      input.tradeDate,
      new Date(input.triggeredAt).toISOString(),
      input.signalType,
      input.stockCode,
      input.stockName.slice(0, 40),
      input.sectorName.slice(0, 80),
      Math.round(input.score),
      input.summary.slice(0, 300),
      JSON.stringify(input.payload ?? {}),
    ).run();
    return Response.json({ saved: true });
  } catch {
    return Response.json({ error: "Signal storage unavailable" }, { status: 503 });
  }
}
