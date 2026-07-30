import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Eastmoney fallback hosts do not fan out into abandoned responses", async () => {
  const source = await readFile(new URL("../app/api/eastmoney/route.ts", import.meta.url), "utf8");
  const helper = source.match(/async function eastmoney\(path: string\) \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(helper.includes("for (const host of EASTMONEY_HOSTS)"));
  assert.ok(helper.includes("response.body?.cancel()"));
  assert.ok(!helper.includes("Promise.any"));
});
