import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the market mainline dashboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>主线雷达｜A股市场主线监测<\/title>/);
  assert.match(html, /当前交易提示/);
  assert.match(html, /主线温度/);
  assert.match(html, /潜在龙头雷达/);
  assert.match(html, /板块强度排行/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("V2 model owns ranking, phases, and five-factor weights", async () => {
  const script = await readFile(new URL("../scripts/update-market.mjs", import.meta.url), "utf8");
  assert.match(script, /NON_THEME_BOARD/);
  assert.match(script, /昨日\|首板\|连板\|涨停/);
  assert.match(script, /replace\(\/\[ⅡⅢ\]\+\$\//);
  assert.match(script, /军工·装备/);
  assert.match(script, /schemaVersion: 2/);
  assert.match(script, /capital: 30/);
  assert.match(script, /strength: 25/);
  assert.match(script, /breadth: 20/);
  assert.match(script, /continuity: 15/);
  assert.match(script, /leadership: 10/);
  assert.doesNotMatch(script, /dayScore|currentScore|midScore/);
});

test("published snapshot follows the V2 contract", async () => {
  const snapshot = JSON.parse(
    await readFile(new URL("../public/market-data.json", import.meta.url), "utf8"),
  );
  assert.equal(snapshot.schemaVersion, 2);
  assert.ok(snapshot.themes.length > 0);
  assert.notEqual(snapshot.market.strongestThemeId, snapshot.market.nextThemeId);
  for (const theme of snapshot.themes) {
    assert.ok(["加速", "启动", "观察", "退潮"].includes(theme.phase));
    assert.equal(typeof theme.score, "number");
    assert.deepEqual(
      Object.keys(theme.components).sort(),
      ["breadth", "capital", "continuity", "leadership", "strength"],
    );
  }
});
