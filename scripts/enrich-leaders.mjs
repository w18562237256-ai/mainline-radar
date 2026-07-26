import { readFile, writeFile } from "node:fs/promises";

const snapshot = JSON.parse(await readFile("public/market-data.json", "utf8"));
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const scale = (value, low, high) => clamp(((value - low) / (high - low)) * 100);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchLeaders(code) {
  const params = new URLSearchParams({
    pn: "1",
    pz: "100",
    po: "1",
    np: "1",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: "2",
    invt: "2",
    fid: "f3",
    fs: `b:${code} f:!50`,
    fields: "f14,f3,f6,f109",
  });
  const hosts = ["29.push2.eastmoney.com", "17.push2.eastmoney.com", "79.push2.eastmoney.com", "7.push2.eastmoney.com", "82.push2.eastmoney.com"];
  let lastError;
  for (const host of hosts) {
    try {
      const response = await fetch(`https://${host}/api/qt/clist/get?${params}`, {
        headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0 MainlineRadarBot/2.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${host}`);
      const json = await response.json();
      const stocks = (json.data?.diff ?? []).filter((stock) => stock.f14 && !stock.f14.includes("退"));
      if (stocks.length < 2) throw new Error(`fewer than two constituents for ${code}`);
      const maxAmount = Math.max(...stocks.map((stock) => Number(stock.f6 ?? 0)), 1);
      return stocks.map((stock) => ({
        name: stock.f14,
        score: scale(Number(stock.f109 ?? stock.f3 ?? 0), -5, 20) * .45
          + scale(Number(stock.f3 ?? 0), -3, 10) * .25
          + (Number(stock.f6 ?? 0) / maxAmount) * 30,
      })).sort((a, b) => b.score - a.score).slice(0, 2)
        .map((stock, index) => ({ rank: index ? "龙二" : "龙一", name: stock.name }));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

let enriched = 0;
for (const theme of snapshot.themes ?? []) {
  try {
    theme.leaders = await fetchLeaders(theme.id);
    enriched += 1;
  } catch {
    // Keep the last verified leader instead of replacing it with fabricated data.
  }
  await delay(500);
}

if (!enriched) throw new Error("No theme received two verified leaders");
const output = `${JSON.stringify(snapshot, null, 2)}\n`;
await writeFile("public/market-data.json", output, "utf8");
await writeFile("docs/market-data.json", output, "utf8");
console.log(`Verified two leaders for ${enriched}/${snapshot.themes.length} displayed themes`);
