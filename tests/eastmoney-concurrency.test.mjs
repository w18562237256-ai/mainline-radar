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
  assert.ok(source.includes("const hierarchyCollapsed = collapseHierarchyDuplicates(normalized)"));
  assert.ok(source.includes("applyHistoricalContinuity(hierarchyCollapsed)"));
});

test("overlapping concept families collapse before mainline ranking and signals", async () => {
  const source = await readFile(new URL("../app/api/eastmoney/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.ok(source.includes("SEMANTIC_THEME_FAMILIES"));
  assert.ok(source.includes("function collapseSemanticThemeDuplicates"));
  assert.ok(source.includes("collapseSemanticThemeDuplicates(continuityApplied)"));
  assert.ok(source.includes('key: "optical-networking"'));
  assert.ok(source.includes('key: "printed-circuit-boards"'));
  assert.ok(source.includes('key: "ai-applications"'));
  assert.ok(source.includes('"光纤概念"'));
  assert.ok(source.includes('"5G概念"'));
  assert.ok(source.includes('"通信"'));
  assert.ok(source.includes("limitUpsExact: false"));
  assert.ok(page.includes("item.sector.limitUpsExact === true"));
  assert.ok(page.includes("item.sector.limitUps >= 2"));
  assert.ok(!page.includes('"互联网服务", "计算机", "软件开发", "信创"'));
});

test("market-universe labels cannot qualify as industry mainlines", async () => {
  const source = await readFile(new URL("../app/api/eastmoney/route.ts", import.meta.url), "utf8");

  assert.ok(source.includes("创业板综"));
  assert.ok(source.includes("创业成份"));
  assert.ok(source.includes("东方财富热股"));
  assert.ok(source.includes(".filter((sector) => !META_BOARD_NAME.test(sector.name))"));
});

test("signal history hides unauditable role and sector pairings", async () => {
  const source = await readFile(new URL("../app/api/signals/route.ts", import.meta.url), "utf8");

  assert.ok(source.includes("VERIFIED_CORE_SIGNALS"));
  assert.ok(source.includes("function isAuditableSignal"));
  assert.ok(source.includes("payload.sector?.limitUpsExact === true"));
  assert.ok(source.includes("Unverified core-sector pairing"));
});

test("stock and browser refreshes are bounded and deduplicated", async () => {
  const stockSource = await readFile(new URL("../app/api/stocks/route.ts", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.ok(stockSource.includes("STOCK_SCAN_BUDGET_MS = 8_000"));
  assert.ok(stockSource.includes("Math.min(STOCK_ATTEMPT_TIMEOUT_MS, remainingMs)"));
  assert.ok(stockSource.includes("preferredStockHost = host"));
  assert.ok(pageSource.includes("if (marketInFlightRef.current) return"));
  assert.ok(pageSource.includes("if (stocksInFlightRef.current) return"));
  assert.ok(pageSource.includes("signal: AbortSignal.timeout(18_000)"));
  assert.ok(pageSource.includes("signal: AbortSignal.timeout(10_000)"));
});
