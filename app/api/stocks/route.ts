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
  "https://20.push2.eastmoney.com",
  "https://82.push2.eastmoney.com",
  "https://push2.eastmoney.com",
];
const STOCK_SCAN_BUDGET_MS = 6_000;
const STOCK_ATTEMPT_TIMEOUT_MS = 2_500;
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

async function fetchStock(code: string) {
  const fields = "f43,f44,f45,f46,f47,f48,f57,f58,f137,f168,f169,f170";
  const path = `/api/qt/stock/get?invt=2&secid=${secid(code)}&ut=${EASTMONEY_UT}&fields=${fields}`;
  let row: EastmoneyStock | null = null;
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
      const json = await response.json() as { data?: EastmoneyStock | null };
      if (!json.data?.f57) continue;
      row = json.data;
      preferredStockHost = host;
      break;
    } catch {
      // Try the next Eastmoney quote node.
    }
  }
  if (!row) throw new Error(`No quote for ${code}`);

  return {
    code: String(row.f57),
    name: String(row.f58 || code),
    price: numeric(row.f43) / 100,
    change: numeric(row.f170) / 100,
    changeValue: numeric(row.f169) / 100,
    open: numeric(row.f46) / 100,
    high: numeric(row.f44) / 100,
    low: numeric(row.f45) / 100,
    volume: numeric(row.f47),
    amount: numeric(row.f48),
    turnover: numeric(row.f168) / 100,
    flow: numeric(row.f137),
  };
}

type StockQuote = Awaited<ReturnType<typeof fetchStock>>;

async function readStockCache(code: string) {
  try {
    await env.DB.prepare(stockCacheSchemaSql).run();
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
    await env.DB.prepare(stockCacheSchemaSql).run();
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

  const cacheEntries = await Promise.all(codes.map(readStockCache));
  const quotes = new Map<string, StockQuote>();
  const staleCodes: string[] = [];
  cacheEntries.forEach((entry, index) => {
    if (entry && entry.ageSeconds < 15) quotes.set(codes[index], entry.quote);
    else staleCodes.push(codes[index]);
  });

  const liveResults = await Promise.allSettled(staleCodes.map(fetchStock));
  const liveUpdatedAt = new Date().toISOString();
  await Promise.all(liveResults.map(async (result, index) => {
    const code = staleCodes[index];
    if (result.status === "fulfilled") {
      quotes.set(code, result.value);
      await writeStockCache(result.value, liveUpdatedAt);
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
  const usedDelayedCache = staleCodes.some((code, index) => {
    const result = liveResults[index];
    return result?.status === "rejected" && quotes.has(code);
  });

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
