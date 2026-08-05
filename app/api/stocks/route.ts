import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";

type EastmoneyStock = Record<string, number | string | null | undefined>;

const EASTMONEY_HEADERS = {
  Accept: "application/json, text/plain, */*",
  Referer: "https://quote.eastmoney.com/",
  "User-Agent": "Mozilla/5.0 (compatible; MainlineRadar/1.0)",
};
const EASTMONEY_UT = "fa5fd1943c7b386f172d6893dbfba10b";
const EASTMONEY_HOSTS = [
  "https://82.push2.eastmoney.com",
  "https://20.push2.eastmoney.com",
  "https://48.push2.eastmoney.com",
  "https://92.push2.eastmoney.com",
  "https://push2.eastmoney.com",
];
// Eastmoney's individual-quote nodes commonly need 4-5 seconds during the
// opening hour. A 3 second attempt timeout made every otherwise valid node
// fail before it could respond, so the API returned an empty fallback batch.
// Keep the total bounded below the browser timeout while allowing two useful
// attempts instead of cancelling every request prematurely.
const STOCK_SCAN_BUDGET_MS = 12_000;
const STOCK_ATTEMPT_TIMEOUT_MS = 5_500;
let preferredStockHost = EASTMONEY_HOSTS[0];
const stockCacheSchemaSql = `CREATE TABLE IF NOT EXISTS stock_quote_cache (
  code TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
)`;

const numeric = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

function secid(code: string) {
  return `${/^(6|68|9)/.test(code) ? "1" : "0"}.${code}`;
}

async function fetchStocks(codes: string[]) {
  // A previous implementation opened one upstream request per stock. With a
  // 7-12 name watchlist this caused Eastmoney and the Worker runtime to cancel
  // whole batches during busy periods. ulist returns the same quote fields for
  // every requested security in one response, so one retry chain now serves
  // the complete watchlist.
  const fields = "f12,f14,f2,f3,f4,f5,f6,f8,f15,f16,f17,f62";
  const path = `/api/qt/ulist.np/get?fltt=2&invt=2&ut=${EASTMONEY_UT}&fields=${fields}&secids=${codes.map(secid).join("%2C")}`;
  let rows: EastmoneyStock[] | null = null;
  const deadline = Date.now() + STOCK_SCAN_BUDGET_MS;
  const hosts = [
    preferredStockHost,
    ...EASTMONEY_HOSTS.filter((host) => host !== preferredStockHost),
  ];
  for (const host of hosts) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 250) break;
    try {
      const response = await fetch(`${host}${path}`, {
        headers: EASTMONEY_HEADERS,
        signal: AbortSignal.timeout(Math.min(STOCK_ATTEMPT_TIMEOUT_MS, remainingMs)),
        cf: { cacheTtl: 0 },
      } as RequestInit & { cf: { cacheTtl: number } });
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      const json = await response.json() as { data?: { diff?: EastmoneyStock[] } | null };
      if (!json.data?.diff?.length) continue;
      rows = json.data.diff;
      preferredStockHost = host;
      break;
    } catch {
      // Try the next Eastmoney quote node.
    }
  }
  if (!rows) throw new Error("No stock quote batch");

  return rows.map((row) => ({
    code: String(row.f12),
    name: String(row.f14 || row.f12 || ""),
    price: numeric(row.f2),
    change: numeric(row.f3),
    changeValue: numeric(row.f4),
    open: numeric(row.f17),
    high: numeric(row.f15),
    low: numeric(row.f16),
    volume: numeric(row.f5),
    amount: numeric(row.f6),
    turnover: numeric(row.f8),
    flow: numeric(row.f62),
  })).filter((quote) => /^\d{6}$/.test(quote.code));
}

type StockQuote = Awaited<ReturnType<typeof fetchStocks>>[number];

async function ensureStockCache() {
  try {
    await env.DB.prepare(stockCacheSchemaSql).run();
  } catch {
    // Live quotes remain usable when the persistent cache is unavailable.
  }
}

async function readStockCache(code: string) {
  try {
    const row = await env.DB.prepare(
      `SELECT updated_at, payload FROM stock_quote_cache WHERE code = ?`
    ).bind(code).first<{ updated_at: string; payload: string }>();
    if (!row) return null;
    return {
      quote: JSON.parse(row.payload) as StockQuote,
      ageSeconds: Math.max(0, Math.floor((Date.now() - new Date(row.updated_at).getTime()) / 1000)),
    };
  } catch {
    return null;
  }
}

async function writeStockCache(quote: StockQuote, updatedAt: string) {
  try {
    await env.DB.prepare(
      `INSERT INTO stock_quote_cache (code, updated_at, payload)
       VALUES (?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         updated_at = excluded.updated_at,
         payload = excluded.payload`
    ).bind(quote.code, updatedAt, JSON.stringify(quote)).run();
  } catch {
    // A cache write failure must not discard a valid live quote.
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("codes") || "";
  const codes = [...new Set(raw.split(",").filter((code) => /^\d{6}$/.test(code)))].slice(0, 12);
  if (!codes.length) return NextResponse.json({ source: "eastmoney", stocks: [] });

  await ensureStockCache();
  const cacheEntries = await Promise.all(codes.map(readStockCache));
  const quotes = new Map<string, StockQuote>();
  const staleCodes: string[] = [];
  cacheEntries.forEach((entry, index) => {
    if (entry && entry.ageSeconds < 15) quotes.set(codes[index], entry.quote);
    else staleCodes.push(codes[index]);
  });

  const liveBatch = staleCodes.length
    ? await fetchStocks(staleCodes).catch(() => [])
    : [];
  const liveByCode = new Map(liveBatch.map((quote) => [quote.code, quote]));
  const liveUpdatedAt = new Date().toISOString();
  await Promise.all(staleCodes.map(async (code) => {
    const liveQuote = liveByCode.get(code);
    if (liveQuote) {
      quotes.set(code, liveQuote);
      await writeStockCache(liveQuote, liveUpdatedAt);
      return;
    }
    const originalIndex = codes.indexOf(code);
    const cached = cacheEntries[originalIndex];
    if (cached && cached.ageSeconds <= 300) quotes.set(code, cached.quote);
  }));
  const stocks = codes.flatMap((code) => {
    const quote = quotes.get(code);
    return quote ? [quote] : [];
  });
  const usedDelayedCache = staleCodes.some((code) => !liveByCode.has(code) && quotes.has(code));

  return NextResponse.json({
    source: stocks.length ? (usedDelayedCache ? "delayed" : "eastmoney") : "fallback",
    updatedAt: liveUpdatedAt,
    stocks,
    requested: codes.length,
    received: stocks.length,
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Data-Source": stocks.length ? (usedDelayedCache ? "Delayed-Cache" : "Eastmoney") : "Fallback",
    },
  });
}
