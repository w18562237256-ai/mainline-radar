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
  assert.match(html, /今天先看这个/);
  assert.match(html, /主线温度/);
  assert.match(html, /龙一/);
  assert.match(html, /龙二/);
  assert.match(html, /只看最重要的/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("V3 model separates industry membership from the active trading catalyst", async () => {
  const script = await readFile(new URL("../scripts/update-market.mjs", import.meta.url), "utf8");
  assert.match(script, /NON_THEME_BOARD/);
  assert.match(script, /昨日\|首板\|连板\|涨停/);
  assert.doesNotMatch(script, /themeGroup|军工·装备|半导体产业链/);
  assert.match(script, /name: theme\.rawName/);
  assert.match(script, /membershipVerified: true/);
  assert.match(script, /schemaVersion: 2/);
  assert.match(script, /capital: 30/);
  assert.match(script, /strength: 25/);
  assert.match(script, /breadth: 20/);
  assert.match(script, /continuity: 15/);
  assert.match(script, /leadership: 10/);
  assert.match(script, /leaderAvgChange >= 7/);
  assert.match(script, /components\.continuity >= 45/);
  assert.match(script, /leaderMode/);
  assert.match(script, /当天催化交叉核验/);
  assert.doesNotMatch(script, /dayScore|currentScore|midScore/);
});

test("published snapshot follows the audited V3 contract", async () => {
  const snapshot = JSON.parse(
    await readFile(new URL("../public/market-data.json", import.meta.url), "utf8"),
  );
  assert.equal(snapshot.schemaVersion, 2);
  assert.ok(snapshot.themes.length > 0);
  assert.notEqual(snapshot.market.strongestThemeId, snapshot.market.nextThemeId);
  const military = snapshot.themes.find((theme) => theme.id === "BK1382");
  const cotton = snapshot.themes.find((theme) => theme.id === "BK1349");
  assert.equal(military.phase, "加速");
  assert.equal(military.name, "兵装重组·军工");
  assert.equal(military.matchedBoard, "地面兵装Ⅲ");
  assert.equal(military.leaders[1].name, "建设工业");
  assert.match(military.signal, /核心股加速|龙头梯队/);
  assert.equal(cotton.leaderMode, "single");
  assert.match(cotton.driver, /VC/);
  assert.match(cotton.attribution, /主营为家纺\+新材料/);
  assert.equal(snapshot.coverage.auditedDisplayed, snapshot.themes.length);
  for (const theme of snapshot.themes) {
    assert.ok(["加速", "启动", "观察", "退潮"].includes(theme.phase));
    assert.equal(typeof theme.score, "number");
    assert.ok(["dragon", "gainers", "single"].includes(theme.leaderMode));
    assert.equal(typeof theme.driver, "string");
    assert.equal(typeof theme.attribution, "string");
    if (theme.confirmed) {
      assert.equal(theme.leaders.length, 2);
      assert.ok(theme.leaders.every((leader) => leader.membershipVerified === true));
      assert.equal(theme.leaderMode, "dragon");
    } else {
      assert.notEqual(theme.leaderMode, "dragon");
    }
    assert.deepEqual(
      Object.keys(theme.components).sort(),
      ["breadth", "capital", "continuity", "leadership", "strength"],
    );
  }
});
