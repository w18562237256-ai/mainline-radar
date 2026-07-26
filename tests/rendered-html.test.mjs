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

test("ranking excludes stock-selection labels and merges duplicate theme levels", async () => {
  const script = await readFile(new URL("../scripts/update-market.mjs", import.meta.url), "utf8");
  assert.match(script, /NON_THEME_BOARD/);
  assert.match(script, /昨日\|首板\|连板\|涨停/);
  assert.match(script, /replace\(\/\[ⅡⅢ\]\+\$\//);
  assert.match(script, /军工装备/);
  assert.match(script, /day < -2 \|\| breadth < \.25/);
});
