import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const signalRouteSource = await readFile(new URL("../app/api/signals/route.ts", import.meta.url), "utf8");

test("keeps sector startup observations separate from individual stock buy points", () => {
  assert.match(pageSource, /当前板块观察/);
  assert.match(pageSource, /板块出现.*首日异动/);
  assert.match(pageSource, /这不是个股买点/);
  assert.match(pageSource, /领涨股.*仅作强弱参照/);
  assert.doesNotMatch(pageSource, /早期买点（观察）/);
  assert.doesNotMatch(pageSource, /首板观察/);
});

test("normalizes historical early events as sector observations", () => {
  assert.match(signalRouteSource, /event\.signal_type === "early"/);
  assert.match(signalRouteSource, /不构成个股买点/);
});
