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
  signalType: "early" | "add" | "recovery" | "core" | "chase" | "precursor";
  stockCode: string;
  stockName: string;
  sectorName: string;
  score: number;
  summary: string;
  payload?: unknown;
};

const VERIFIED_CORE_SIGNALS: Record<string, { name: string; sectors: Set<string> }> = {
  "300364": { name: "中文在线", sectors: new Set(["AI应用", "AIGC概念", "ChatGPT概念", "AI智能体"]) },
  "300058": { name: "蓝色光标", sectors: new Set(["AI应用", "AIGC概念", "ChatGPT概念", "AI智能体"]) },
};

function isAuditableSignal(row: Record<string, unknown>) {
  if (row.signal_type === "core") {
    const verified = VERIFIED_CORE_SIGNALS[String(row.stock_code)];
    return Boolean(verified
      && verified.name === row.stock_name
      && verified.sectors.has(String(row.sector_name)));
  }
  if (row.signal_type === "chase") {
    try {
      const payload = JSON.parse(String(row.payload || "{}")) as {
        sector?: { limitUps?: number; limitUpsExact?: boolean };
      };
      return payload.sector?.limitUpsExact === true
        && Number(payload.sector.limitUps) >= 2;
    } catch {
      return false;
    }
  }
  if (row.signal_type === "precursor") {
    try {
      const payload = JSON.parse(String(row.payload || "{}")) as {
        stock?: { code?: string; change?: number; turnover?: number; flow?: number };
        sector?: { leaderCode?: string; score?: number; flow?: number; breadth?: number };
        confirmationHits?: number;
      };
      return payload.stock?.code === row.stock_code
        && payload.sector?.leaderCode === row.stock_code
        && Number(payload.confirmationHits) >= 3
        && Number(payload.stock?.change) >= 3
        && Number(payload.stock?.change) < 8.5
        && Number(payload.stock?.turnover) >= 2.5
        && Number(payload.stock?.flow) > 0
        && Number(payload.sector?.score) >= 68
        && Number(payload.sector?.flow) > 0
        && Number(payload.sector?.breadth) >= 58;
    } catch {
      return false;
    }
  }
  return true;
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
    const query = date
      ? env.DB.prepare(`SELECT event_key, trade_date, triggered_at, signal_type, stock_code,
          stock_name, sector_name, score, summary, payload FROM signal_events
          WHERE trade_date = ? ORDER BY triggered_at DESC LIMIT 50`).bind(date)
      : env.DB.prepare(`SELECT event_key, trade_date, triggered_at, signal_type, stock_code,
          stock_name, sector_name, score, summary, payload FROM signal_events
          ORDER BY triggered_at DESC LIMIT 50`);
    const { results } = await query.all();
    const events = (results ?? [])
      .filter((row) => isAuditableSignal(row as Record<string, unknown>))
      .map((row) => {
        const event = { ...row } as Record<string, unknown>;
        if (event.signal_type === "early") {
          event.summary = `${String(event.sector_name)}进入早期观察；领涨股仅作强弱参照，不构成个股买点。`;
        }
        delete event.payload;
        return event;
      });
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
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
      || !["early", "add", "recovery", "core", "chase", "precursor"].includes(input.signalType)
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
    if (input.signalType === "core") {
      const verified = VERIFIED_CORE_SIGNALS[input.stockCode];
      if (!verified || verified.name !== input.stockName || !verified.sectors.has(input.sectorName)) {
        return Response.json({ error: "Unverified core-sector pairing" }, { status: 400 });
      }
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
