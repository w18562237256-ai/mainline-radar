import { readFile, writeFile } from "node:fs/promises";

const snapshot = JSON.parse(await readFile("public/market-data.json", "utf8"));

const audit = {
  BK1326: {
    displayType: "主线题材",
    driver: "全球半导体扩产、国产设备替代与长鑫科技资本开支预期",
    attribution: "行业归属与当天上涨逻辑一致；托伦斯4天3板，光力科技20CM涨停，龙头梯队成立",
    leaderMode: "dragon",
    signal: "半导体设备逆势领涨，托伦斯4天3板，光力科技20CM涨停；资金与涨停梯队共振，但板块5日持续性仍不足，定为启动",
  },
  BK1382: {
    name: "兵装重组·军工",
    displayType: "主线题材",
    driver: "兵装重组预期叠加军工订单回暖",
    attribution: "行情源板块是地面兵装Ⅲ；建设工业虽不是该细分行业成分股，但属于本轮兵装重组核心股，因此按题材龙二处理",
    leaderMode: "dragon",
  },
  BK1587: {
    displayType: "防御方向",
    driver: "弱市环境下高股息、低波动防御",
    attribution: "中国电信、中国移动是板块领涨代表，不构成短线龙头梯队",
    leaderMode: "gainers",
  },
  BK1349: {
    displayType: "行业板块",
    driver: "孚日股份本次异动由电解液添加剂VC涨价、中报预增驱动",
    attribution: "孚日股份申万行业确属棉纺，主营为家纺+新材料；本次上涨不能归因为棉纺板块",
    leaderMode: "single",
    signal: "棉纺板块仅3涨6跌，孚日股份的涨停逻辑来自VC添加剂而非棉纺扩散，属于单股带动，不能认定为棉纺主线",
    action: "按VC添加剂涨价线观察孚日股份，不按棉纺主线跟踪",
    risk: "VC价格回落、供给恢复，或孚日股份断板而同题材无补涨时，异动逻辑失效",
  },
  BK1521: {
    displayType: "行业板块",
    driver: "个股强弱为主，板块没有形成连续涨停梯队",
    attribution: "涛涛车业仅作为当日板块领涨股，不标龙一",
    leaderMode: "single",
  },
  BK1573: {
    displayType: "行业板块",
    driver: "油价与地缘交易分歧，板块当日明显回落",
    attribution: "贝肯能源、*ST准油仅是相对抗跌股，不是主线龙头",
    leaderMode: "gainers",
  },
  BK1611: {
    displayType: "防御方向",
    driver: "弱市中的大行防御与流动性预期",
    attribution: "交通银行、农业银行是相对领涨，不使用龙一、龙二称呼",
    leaderMode: "gainers",
  },
  BK1532: {
    displayType: "行业板块",
    driver: "单股表现为主，行业扩散和持续性不足",
    attribution: "中锐股份仅为板块领涨股，未形成龙头梯队",
    leaderMode: "single",
  },
  BK1503: {
    displayType: "行业板块",
    driver: "安德利涨停带动，板块仅2只股票上涨",
    attribution: "安德利、朗源股份是当日领涨排序，不等同于市场龙一、龙二",
    leaderMode: "gainers",
  },
  BK1524: {
    displayType: "行业板块",
    driver: "单股表现为主，板块强度、扩散均不足",
    attribution: "阿尔特仅为板块领涨股，未形成龙头梯队",
    leaderMode: "single",
  },
  BK1610: {
    displayType: "防御方向",
    driver: "弱市中的银行防御与流动性预期",
    attribution: "中信银行、招商银行是相对领涨，不使用龙一、龙二称呼",
    leaderMode: "gainers",
  },
  BK1616: {
    displayType: "行业板块",
    driver: "前期资源行情获利回吐，白银板块当日普跌",
    attribution: "盛达资源只是相对抗跌代表，退潮阶段不设置龙头",
    leaderMode: "single",
  },
  BK1419: {
    displayType: "行业板块",
    driver: "煤化工整体回落，金牛化工属于逆势个股表现",
    attribution: "金牛化工、金煤科技是当日领涨排序，不构成主线梯队",
    leaderMode: "gainers",
  },
  BK1434: {
    displayType: "行业板块",
    driver: "钾肥板块整体退潮，无有效进攻梯队",
    attribution: "盐湖股份、藏格矿业仅为跌幅较小的成分股，不应标为龙头",
    leaderMode: "gainers",
  },
};

for (const theme of snapshot.themes ?? []) {
  Object.assign(theme, audit[theme.id] ?? {
    displayType: "行业板块",
    driver: "等待题材催化与行业归属交叉核验",
    attribution: "仅保留行情源行业归属，不自动解释为当天上涨原因",
    leaderMode: "single",
  });
}

snapshot.coverage.auditedDisplayed = snapshot.themes.length;
snapshot.methodology.name = "主线归因模型 V3";
snapshot.methodology.rule = "先区分静态行业归属与当天上涨题材，再用资金、强度、扩散、持续性和龙头梯队判断阶段；观察和退潮板块只标领涨股，不标龙一、龙二。";

const output = `${JSON.stringify(snapshot, null, 2)}\n`;
await writeFile("public/market-data.json", output, "utf8");
await writeFile("docs/market-data.json", output, "utf8");
console.log(`Audited ${snapshot.themes.length} displayed themes`);
