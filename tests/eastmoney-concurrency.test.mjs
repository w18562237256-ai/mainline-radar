import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Eastmoney fallback hosts do not fan out into abandoned responses", async () => {
  const source = await readFile(new URL("../app/api/eastmoney/route.ts", import.meta.url), "utf8");
  const helper = source.match(/async function eastmoney\(path: string\) \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(helper.includes("for (const host of hosts)"));
  assert.ok(helper.includes("response.body?.cancel()"));
  assert.ok(helper.includes("deadline - Date.now()"));
  assert.ok(helper.includes("Math.min(EASTMONEY_ATTEMPT_TIMEOUT_MS, remainingMs)"));
  assert.ok(helper.includes("preferredEastmoneyHost = host"));
  assert.ok(!helper.includes("Promise.any"));
});

test("market scan requests each complete board universe only once", async () => {
  const source = await readFile(new URL("../app/api/eastmoney/route.ts", import.meta.url), "utf8");

  assert.ok(source.includes("EASTMONEY_SCAN_BUDGET_MS = 12_000"));
  assert.ok(source.includes("EASTMONEY_ATTEMPT_TIMEOUT_MS = 4_000"));
  assert.ok(source.includes("const broadResults = results.slice(1, 3)"));
  assert.ok(source.includes("broadSourcesExpected: 2"));
  assert.ok(!source.includes("conceptMomentumUrl"));
  assert.ok(!source.includes("industryMomentumUrl"));
});

test("hierarchical Eastmoney duplicates collapse before ranking and continuity", async () => {
  const source = await readFile(new URL("../app/api/eastmoney/route.ts", import.meta.url), "utf8");

  assert.ok(source.includes("function collapseHierarchyDuplicates"));
  assert.ok(source.includes("function isSameHierarchyQuote"));
  assert.ok(source.includes("hierarchyDepth(right.name) - hierarchyDepth(left.name)"));
  assert.ok(source.includes("applyHistoricalContinuity(collapseHierarchyDuplicates(normalized))"));
});

test("stock and browser refreshes are bounded and deduplicated", async () => {
  const stockSource = await readFile(new URL("../app/api/stocks/route.ts", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.ok(stockSource.includes("STOCK_SCAN_BUDGET_MS = 6_000"));
  assert.ok(stockSource.includes("Math.min(STOCK_ATTEMPT_TIMEOUT_MS, remainingMs)"));
  assert.ok(stockSource.includes("preferredStockHost = host"));
  assert.ok(pageSource.includes("if (marketInFlightRef.current) return"));
  assert.ok(pageSource.includes("if (stocksInFlightRef.current) return"));
  assert.ok(pageSource.includes("signal: AbortSignal.timeout(18_000)"));
  assert.ok(pageSource.includes("signal: AbortSignal.timeout(10_000)"));
});
