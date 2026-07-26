import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function builtServerSource() {
  const root = new URL("../dist/server/", import.meta.url);
  const files = await readdir(root, { recursive: true });
  const javascript = files.filter((file) => file.endsWith(".js"));
  return (await Promise.all(javascript.map((file) => readFile(new URL(file, root), "utf8")))).join("\n");
}

test("server-renders the market mainline dashboard shell", async () => {
  const source = await builtServerSource();
  assert.match(source, /主线雷达｜A股前向信号监测/);
  assert.match(source, /今天先看这个/);
  assert.match(source, /主线温度/);
  assert.match(source, /前向实时监测/);
  assert.match(source, /信号首次出现记录/);
  assert.match(source, /只看最重要的/);
  assert.doesNotMatch(source, /codex-preview|Your site is taking shape/);
});

test("V4 model scans live boards and keeps attribution separate from membership", async () => {
  const script = await readFile(new URL("../scripts/update-market.mjs", import.meta.url), "utf8");
  const liveModel = await readFile(new URL("../app/lib/live-market.ts", import.meta.url), "utf8");
  const marketRoute = await readFile(new URL("../app/api/market/route.ts", import.meta.url), "utf8");
  assert.match(script, /NON_THEME_BOARD/);
  assert.match(script, /昨日\|首板\|连板\|涨停/);
  assert.doesNotMatch(script, /themeGroup|军工·装备|半导体产业链/);
  assert.match(script, /name: theme\.rawName/);
  assert.match(script, /constituentVerified: true/);
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
  assert.match(liveModel, /REQUIRED_COVERAGE_BOARDS = \["BK0457"\]/);
  assert.match(liveModel, /detail_only_excluded_from_ranking/);
  assert.doesNotMatch(liveModel, /if \(!byId\.has\(id\)\) byId\.set/);
  assert.match(liveModel, /positiveDays5 >= 3/);
  assert.match(liveModel, /strongestThemeId: confirmedThemes\[0\]\?\.id \?\? null/);
  assert.match(liveModel, /\.filter\(\(theme\) => theme\.sessionDate === sessionDate\)/);
  assert.match(liveModel, /const firstCandidate = marketStatus === "trading"/);
  assert.match(liveModel, /constituentVerified: true/);
  assert.match(liveModel, /themeRelationVerified: false/);
  assert.match(liveModel, /historyValid/);
  assert.match(marketRoute, /getLiveMarket/);
  assert.match(marketRoute, /persistSignals/);
  assert.match(marketRoute, /INSERT OR IGNORE INTO signal_observations/);
});

test("historical replay is labeled and never masquerades as a prediction", async () => {
  const snapshot = JSON.parse(
    await readFile(new URL("../public/market-data.json", import.meta.url), "utf8"),
  );
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.dataRevision, "historical-replay-2026-07-24");
  assert.ok(snapshot.themes.length > 0);
  assert.notEqual(snapshot.market.strongestThemeId, snapshot.market.nextThemeId);
  const military = snapshot.themes.find((theme) => theme.id === "BK1382");
  const cotton = snapshot.themes.find((theme) => theme.id === "BK1349");
  const grid = snapshot.themes.find((theme) => theme.id === "BK0457");
  assert.equal(military.phase, "加速");
  assert.equal(military.name, "兵装重组·军工");
  assert.equal(military.matchedBoard, "地面兵装Ⅲ");
  assert.equal(military.leaders[1].name, "建设工业");
  assert.equal(military.leaders[1].constituentVerified, false);
  assert.equal(military.leaders[1].themeRelationVerified, true);
  assert.equal("membershipVerified" in military.leaders[1], false);
  assert.match(military.signal, /核心股加速|龙头梯队/);
  assert.equal(cotton.leaderMode, "single");
  assert.match(cotton.driver, /VC/);
  assert.match(cotton.attribution, /主营为家纺\+新材料/);
  assert.equal(snapshot.coverage.auditedDisplayed, snapshot.themes.length);
  assert.equal(grid.manualReview, true);
  assert.equal(grid.leaders[0].name, "长缆科技");
  assert.match(grid.action, /历史补录/);
  for (const theme of snapshot.themes) {
    assert.ok(["加速", "启动", "观察", "退潮"].includes(theme.phase));
    assert.equal(typeof theme.score, "number");
    assert.ok(["dragon", "gainers", "single"].includes(theme.leaderMode));
    assert.equal(typeof theme.driver, "string");
    assert.equal(typeof theme.attribution, "string");
    if (theme.confirmed) {
      assert.equal(theme.leaders.length, 2);
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

test("five-day continuity rejects contradictory history instead of scoring it", async () => {
  const source = await readFile(new URL("../app/lib/live-market.ts", import.meta.url), "utf8");
  assert.match(source, /fiveDay > 0\.05 && positiveDays5 === 0/);
  assert.match(source, /history\.valid[\s\S]*continuity/);
  assert.match(source, /historyValid: board\.history\.valid/);
});
