"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Phase = "启动" | "加速" | "分歧" | "退潮" | "观察";

type Sector = {
  id: string;
  name: string;
  category?: "产业主线" | "风格主线" | "持仓标签";
  code: string;
  score: number;
  phase: Phase;
  change: number;
  flow: number;
  streak: number;
  limitUps: number;
  breadth: number;
  leader: string;
  leaderCode?: string;
  leaderChange: number;
  signal: string;
  risk: string;
  trend: number[];
  tags: string[];
  stocks: { name: string; code: string; role: string; state: string }[];
};

type MarketIndex = {
  code: string;
  name: string;
  price: number;
  change: number;
  amount: number;
};

type MarketPayload = {
  source: "eastmoney" | "delayed" | "fallback";
  updatedAt: string;
  quoteAt?: string;
  marketSession?: "preopen" | "auction" | "continuous" | "lunch" | "closed";
  session?: "auction" | "continuous";
  indices: MarketIndex[];
  sectors: Sector[];
  cacheHit?: boolean;
  dataAgeSeconds?: number;
  error?: string;
  scanCoverage?: {
    fetchedBoards?: number;
    broadSourcesReady?: number;
    broadSourcesExpected?: number;
  };
};

type HistorySummary = {
  trade_date: string;
  first_captured_at: string;
  latest_captured_at: string;
  sample_count: number;
  first_mainline: string;
  first_leader: string;
  first_score: number;
  latest_mainline: string;
  latest_leader: string;
  latest_score: number;
};

type HistorySnapshot = {
  trade_date: string;
  first_captured_at: string;
  first_payload: string;
  latest_captured_at: string;
  latest_payload: string;
  sample_count: number;
};

type SignalEvent = {
  event_key: string;
  trade_date: string;
  triggered_at: string;
  signal_type: "early" | "add" | "recovery";
  stock_code: string;
  stock_name: string;
  sector_name: string;
  score: number;
  summary: string;
};

const isMainlineQualified = (sector: Sector) =>
  sector.category !== "持仓标签"
  && sector.score >= 65
  && sector.flow > 0
  && sector.breadth >= 50;

// Signals may use a complete quote for up to 2 minutes 30 seconds. Longer
// interruptions still fail closed so a stale board scan can never create a
// buy or add-position prompt.
const SIGNAL_FRESHNESS_SECONDS = 150;

type View = "mainline" | "funds" | "stocks";

type StockQuote = {
  code: string;
  name: string;
  price: number;
  change: number;
  changeValue: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  turnover: number;
  flow: number;
};

const fallbackSectors: Sector[] = [
  {
    id: "defense",
    name: "军工·兵装重组",
    code: "880507",
    score: 91,
    phase: "加速",
    change: 4.82,
    flow: 4.88,
    streak: 3,
    limitUps: 6,
    breadth: 78,
    leader: "长城军工",
    leaderChange: 9.99,
    signal: "龙头二连板，板块逆势扩散，主导资金净买入明确。",
    risk: "周一进入三板分歧窗口，高开一致需警惕兑现。",
    trend: [42, 45, 51, 58, 61, 74, 91],
    tags: ["资金共振", "龙头清晰", "板块扩散"],
    stocks: [
      { name: "长城军工", code: "601606", role: "情绪龙头", state: "二连板" },
      { name: "建设工业", code: "002265", role: "核心补涨", state: "首板" },
      { name: "湖南天雁", code: "600698", role: "低位弹性", state: "首板" },
    ],
  },
  {
    id: "semiconductor",
    name: "半导体设备",
    code: "886063",
    score: 76,
    phase: "启动",
    change: 0.01,
    flow: 33.06,
    streak: 1,
    limitUps: 1,
    breadth: 64,
    leader: "中科飞测",
    leaderChange: 6.9,
    signal: "指数弱势中获33.06亿元回流，设备、检测、材料同步承接。",
    risk: "仍是回流首日，周线套牢盘重，需连续两日增量确认。",
    trend: [69, 62, 54, 48, 51, 61, 76],
    tags: ["逆势流入", "机构容量", "首日确认"],
    stocks: [
      { name: "北方华创", code: "002371", role: "容量核心", state: "趋势修复" },
      { name: "中科飞测", code: "688361", role: "弹性核心", state: "+6.90%" },
      { name: "正帆科技", code: "688596", role: "材料先锋", state: "+7.73%" },
    ],
  },
  {
    id: "electrolyte",
    name: "电解液添加剂",
    code: "BK1217",
    score: 72,
    phase: "启动",
    change: 3.16,
    flow: 2.74,
    streak: 2,
    limitUps: 2,
    breadth: 57,
    leader: "孚日股份",
    leaderChange: 10.03,
    signal: "VC单月涨价超过40%，涨价逻辑开始向容量品种扩散。",
    risk: "当前仍偏小题材，需天赐材料等容量票确认。",
    trend: [31, 35, 38, 40, 47, 58, 72],
    tags: ["价格催化", "业绩弹性", "二连板"],
    stocks: [
      { name: "孚日股份", code: "002083", role: "情绪先锋", state: "二连板" },
      { name: "永太科技", code: "002326", role: "容量跟随", state: "首板" },
      { name: "天赐材料", code: "002709", role: "机构锚点", state: "待确认" },
    ],
  },
  {
    id: "urban",
    name: "城市更新",
    code: "BK1062",
    score: 58,
    phase: "观察",
    change: 1.34,
    flow: 0.62,
    streak: 1,
    limitUps: 3,
    breadth: 42,
    leader: "深物业A",
    leaderChange: 9.99,
    signal: "低位地产国企出现涨停集群，具备政策与超跌双重催化。",
    risk: "行业资金尚未形成连续流入，基本面验证不足。",
    trend: [44, 41, 38, 36, 43, 49, 58],
    tags: ["低位超跌", "政策预期", "题材试盘"],
    stocks: [
      { name: "深物业A", code: "000011", role: "题材先锋", state: "首板" },
      { name: "合肥城建", code: "002208", role: "国资弹性", state: "涨停" },
      { name: "荣丰控股", code: "000668", role: "低价补涨", state: "涨停" },
    ],
  },
  {
    id: "environment",
    name: "环保",
    code: "801970",
    score: 51,
    phase: "观察",
    change: 0.38,
    flow: 0.78,
    streak: 1,
    limitUps: 0,
    breadth: 51,
    leader: "中电环保",
    leaderChange: 0.71,
    signal: "大盘普跌时少数获得行业资金净流入的防御方向。",
    risk: "缺乏涨停核心和明确事件催化，暂未形成赚钱效应。",
    trend: [43, 45, 41, 44, 46, 49, 51],
    tags: ["防御切换", "逆势流入", "等待核心"],
    stocks: [
      { name: "中电环保", code: "300172", role: "强度观察", state: "+0.71%" },
      { name: "谱尼测试", code: "300887", role: "事件弹性", state: "震荡" },
      { name: "雪迪龙", code: "002658", role: "容量观察", state: "待确认" },
    ],
  },
  {
    id: "power",
    name: "电力",
    code: "881145",
    score: 34,
    phase: "退潮",
    change: -4.31,
    flow: -18.6,
    streak: -1,
    limitUps: 1,
    breadth: 18,
    leader: "立新能源",
    leaderChange: 7.6,
    signal: "前期高标断板，板块出现大面积亏钱效应。",
    risk: "豫能控股、协鑫能科跌停，资金撤离尚未结束。",
    trend: [82, 86, 91, 88, 74, 51, 34],
    tags: ["高标断板", "资金流出", "回避追高"],
    stocks: [
      { name: "立新能源", code: "001258", role: "前期高标", state: "断板" },
      { name: "豫能控股", code: "001896", role: "前排", state: "跌停" },
      { name: "协鑫能科", code: "002015", role: "容量核心", state: "跌停" },
    ],
  },
];

const unavailableSector: Sector = {
  ...fallbackSectors[0],
  id: "unavailable",
  name: "数据不可用",
  code: "—",
  score: 0,
  phase: "观察",
  change: 0,
  flow: 0,
  streak: 0,
  limitUps: 0,
  breadth: 0,
  leader: "不生成判断",
  leaderChange: 0,
  signal: "实时行情未成功返回，主线、龙头与买点模型已暂停。",
  risk: "数据恢复前不要使用页面中的任何方向作为交易依据。",
  trend: [0, 0, 0, 0, 0, 0, 0],
  tags: ["模型暂停", "等待实时数据"],
  stocks: [],
};

const phases: ("全部" | Phase)[] = ["全部", "启动", "加速", "分歧", "退潮", "观察"];

function phaseClass(phase: Phase) {
  return `phase phase-${phase}`;
}

function confirmationChecks(sector: Sector) {
  return [
    {
      label: "资金方向",
      value: `${sector.flow >= 0 ? "+" : ""}${sector.flow.toFixed(2)}亿`,
      detail: sector.flow > 0 ? "主力资金为净流入，说明当前存在主动承接。" : "主力资金仍在净流出，暂不支持主线确认。",
      status: sector.flow > 0 ? "pass" : "fail",
    },
    {
      label: "板块扩散",
      value: `${sector.breadth}%`,
      detail: sector.breadth >= 60 ? "上涨家数占比超过60%，赚钱效应已扩散。" : sector.breadth >= 45 ? "上涨家数接近一半，仍需更多个股同步走强。" : "上涨家数偏少，当前更像局部个股行情。",
      status: sector.breadth >= 60 ? "pass" : sector.breadth >= 45 ? "wait" : "fail",
    },
    {
      label: "板块强度",
      value: `${sector.change >= 0 ? "+" : ""}${sector.change.toFixed(2)}%`,
      detail: sector.change >= 1.5 ? "板块涨幅达到进攻标准，强于普通轮动。" : sector.change >= 0 ? "板块保持上涨，但强度尚未达到主升标准。" : "板块指数收跌，需要等待止跌回流。",
      status: sector.change >= 1.5 ? "pass" : sector.change >= 0 ? "wait" : "fail",
    },
    {
      label: "龙头表现",
      value: `${sector.leader} ${sector.leaderChange >= 0 ? "+" : ""}${sector.leaderChange.toFixed(2)}%`,
      detail: sector.leaderChange >= 5 ? "领涨股具备明显辨识度，能够带动板块情绪。" : sector.leaderChange >= 0 ? "领涨股保持强势，但带动作用仍需确认。" : "领涨股转弱，板块缺少有效带动者。",
      status: sector.leaderChange >= 5 ? "pass" : sector.leaderChange >= 0 ? "wait" : "fail",
    },
    {
      label: "持续性",
      value: sector.streak >= 2 ? `连续${sector.streak}日` : sector.streak === 1 ? "首日启动" : "尚未连续",
      detail: sector.streak >= 2 ? "资金与强度已连续维持，主线可信度提高。" : sector.streak === 1 ? "当前只有一个交易日信号，次日必须继续验证。" : "尚未形成连续性，不能仅凭单次异动确认。",
      status: sector.streak >= 2 ? "pass" : sector.streak === 1 ? "wait" : "fail",
    },
  ] as const;
}

function formatUpdateTime(value: string) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatTradeDate(value: string) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(new Date(value));
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 36 - ((v - min) / Math.max(max - min, 1)) * 30;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="实时结构分示意">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function Home() {
  const [activeView, setActiveView] = useState<View>("mainline");
  const [sectorData, setSectorData] = useState<Sector[]>([]);
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [activePhase, setActivePhase] = useState<(typeof phases)[number]>("全部");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"score" | "flow" | "change">("score");
  const [selectedId, setSelectedId] = useState<string>("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<MarketPayload["source"]>("fallback");
  const [updatedAt, setUpdatedAt] = useState("");
  const [quoteAt, setQuoteAt] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [secondsLeft, setSecondsLeft] = useState(20);
  const [stockCodes, setStockCodes] = useState<string[]>(["002980", "601606", "002265", "301392"]);
  const [stockQuotes, setStockQuotes] = useState<StockQuote[]>([]);
  const [stockInput, setStockInput] = useState("");
  const [stockError, setStockError] = useState("");
  const [stockLoading, setStockLoading] = useState(false);
  const [stockUpdatedAt, setStockUpdatedAt] = useState("");
  const [historyDates, setHistoryDates] = useState<HistorySummary[]>([]);
  const [historyDate, setHistoryDate] = useState("");
  const [historySnapshot, setHistorySnapshot] = useState<HistorySnapshot | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [signalEvents, setSignalEvents] = useState<SignalEvent[]>([]);
  const marketInFlightRef = useRef(false);
  const stocksInFlightRef = useRef(false);
  const evidenceRef = useRef<HTMLElement | null>(null);
  const stockCodesRef = useRef(stockCodes);
  const lastSnapshotRef = useRef(0);
  const lastSignalRef = useRef("");

  const shanghaiNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const shanghaiMinutes = shanghaiNow.getHours() * 60 + shanghaiNow.getMinutes();
  const isTradingDay = shanghaiNow.getDay() >= 1 && shanghaiNow.getDay() <= 5;
  const isAuctionObserve = isTradingDay && shanghaiMinutes >= 555 && shanghaiMinutes < 560;
  const isAuctionLocked = isTradingDay && shanghaiMinutes >= 560 && shanghaiMinutes < 565;
  const isAuctionPreview = isTradingDay && shanghaiMinutes >= 565 && shanghaiMinutes < 570;
  const isAuctionWindow = isAuctionObserve || isAuctionLocked || isAuctionPreview;
  const isPreOpen = isTradingDay && shanghaiMinutes < 570;
  const isTradingTime = isTradingDay && (
    (shanghaiMinutes >= 570 && shanghaiMinutes <= 690) ||
    (shanghaiMinutes >= 780 && shanghaiMinutes <= 900)
  );
  const updatedAtMs = new Date(updatedAt).getTime();
  const dataAgeSeconds = Number.isFinite(updatedAtMs)
    ? Math.max(0, Math.floor((nowMs - updatedAtMs) / 1000))
    : Number.MAX_SAFE_INTEGER;
  const hasDisplayData = source !== "fallback" && sectorData.length > 0;
  const modelReady = hasDisplayData && dataAgeSeconds <= SIGNAL_FRESHNESS_SECONDS && isTradingTime;
  const auctionReady = hasDisplayData && dataAgeSeconds <= SIGNAL_FRESHNESS_SECONDS && isAuctionWindow;
  const quoteTimestamp = quoteAt || updatedAt;
  const quoteTradeDate = formatTradeDate(quoteTimestamp);
  const currentTradeDate = formatTradeDate(new Date(nowMs).toISOString());
  const lunchReviewReady = hasDisplayData
    && isTradingDay
    && shanghaiMinutes > 690
    && shanghaiMinutes < 780
    && quoteTradeDate === currentTradeDate;
  const closeReviewReady = hasDisplayData
    && isTradingDay
    && shanghaiMinutes > 900
    && quoteTradeDate !== "—"
    && quoteTradeDate === currentTradeDate;
  const analysisReady = modelReady || lunchReviewReady || closeReviewReady || auctionReady;
  const delayLabel = Number.isFinite(dataAgeSeconds) && dataAgeSeconds < Number.MAX_SAFE_INTEGER
    ? `${Math.ceil(dataAgeSeconds / 60)}分钟`
    : "未知";
  const effectiveSectors = useMemo(
    () => analysisReady ? sectorData : [],
    [analysisReady, sectorData],
  );
  const selected = effectiveSectors.find((sector) => sector.id === selectedId) ?? effectiveSectors[0] ?? unavailableSector;

  const visible = useMemo(() => {
    return [...effectiveSectors]
      .filter((sector) => activePhase === "全部" || sector.phase === activePhase)
      .filter((sector) => `${sector.name}${sector.leader}${sector.code}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b[sort] - a[sort]);
  }, [activePhase, effectiveSectors, sort, query]);

  const fetchHistory = useCallback(async (date?: string) => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/history${date ? `?date=${encodeURIComponent(date)}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as { dates?: HistorySummary[]; snapshot?: HistorySnapshot | null };
      if (date) {
        setHistorySnapshot(payload.snapshot ?? null);
      } else {
        const dates = payload.dates ?? [];
        setHistoryDates(dates);
        if (dates[0]) {
          setHistoryDate((current) => current || dates[0].trade_date);
          const detailResponse = await fetch(`/api/history?date=${encodeURIComponent(dates[0].trade_date)}`, { cache: "no-store" });
          const detail = await detailResponse.json() as { snapshot?: HistorySnapshot | null };
          setHistorySnapshot(detail.snapshot ?? null);
        }
      }
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const fetchSignals = useCallback(async () => {
    try {
      const response = await fetch("/api/signals", { cache: "no-store" });
      const payload = await response.json() as { events?: SignalEvent[] };
      setSignalEvents(payload.events ?? []);
    } catch {
      // Signal history is supplementary; live monitoring remains available.
    }
  }, []);

  const fetchMarket = useCallback(async () => {
    if (marketInFlightRef.current) return;
    marketInFlightRef.current = true;
    const scrollY = window.scrollY;
    setLoading(true);
    try {
      const response = await fetch("/api/eastmoney", {
        cache: "no-store",
        // The server may need to rotate through official quote nodes during
        // volatile sessions. Do not cancel that recovery path from the browser
        // before the server-wide scan budget has elapsed.
        signal: AbortSignal.timeout(18_000),
      });
      if (!response.ok) throw new Error(`行情请求失败：${response.status}`);
      const payload = await response.json() as MarketPayload;
      if (payload.indices.length) setIndices(payload.indices);
      else setIndices([]);
      if (payload.sectors.length) {
        setSectorData(payload.sectors);
        setSelectedId((current) => payload.sectors.some((sector) => sector.id === current) ? current : payload.sectors[0].id);
      } else {
        setSectorData([]);
        setSelectedId("");
      }
      setSource(payload.source);
      setUpdatedAt(payload.updatedAt);
      setQuoteAt(payload.quoteAt || payload.updatedAt);
      const marketNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
      const marketMinute = marketNow.getHours() * 60 + marketNow.getMinutes();
      const marketDay = marketNow.getDay();
      const canSnapshot = marketDay >= 1 && marketDay <= 5 && (
        (marketMinute >= 560 && marketMinute < 570) ||
        (marketMinute >= 570 && marketMinute <= 690) ||
        (marketMinute >= 780 && marketMinute <= 900)
      );
      const payloadAge = payload.dataAgeSeconds ?? Math.max(0, Math.floor((Date.now() - new Date(payload.updatedAt).getTime()) / 1000));
      if (canSnapshot && payload.source === "eastmoney" && payloadAge <= SIGNAL_FRESHNESS_SECONDS && payload.sectors.length && Date.now() - lastSnapshotRef.current > 5 * 60_000) {
        lastSnapshotRef.current = Date.now();
        void fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, session: marketMinute < 570 ? "auction" : "continuous" }),
        }).then(() => fetchHistory()).catch(() => undefined);
      }
      setSecondsLeft(20);
      requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" }));
    } catch {
      setSource((current) => current === "fallback" ? "fallback" : "delayed");
    } finally {
      marketInFlightRef.current = false;
      setLoading(false);
    }
  }, [fetchHistory]);

  const fetchStocks = useCallback(async (codes: string[]) => {
    if (stocksInFlightRef.current) return;
    if (!codes.length) {
      setStockQuotes([]);
      return;
    }
    stocksInFlightRef.current = true;
    setStockLoading(true);
    try {
      const response = await fetch(`/api/stocks?codes=${encodeURIComponent(codes.join(","))}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("个股行情请求失败");
      const payload = await response.json() as { source?: "eastmoney" | "delayed" | "fallback"; updatedAt?: string; stocks: StockQuote[] };
      if (!payload.stocks?.length) throw new Error("个股行情为空");
      setStockQuotes(payload.stocks);
      setStockUpdatedAt(payload.updatedAt || new Date().toISOString());
      setStockError(payload.source === "delayed" ? "部分个股暂时使用最近一次有效行情，页面会继续自动重试" : "");
    } catch {
      setStockError("东财个股行情暂时未响应，已保留自选和上一份数据，可点右侧刷新重试");
    } finally {
      stocksInFlightRef.current = false;
      setStockLoading(false);
    }
  }, []);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hash === "funds" || hash === "stocks" || hash === "mainline") setActiveView(hash);
    const onHashChange = () => {
      const next = window.location.hash.replace("#", "");
      if (next === "funds" || next === "stocks" || next === "mainline") setActiveView(next);
    };
    window.addEventListener("hashchange", onHashChange);
    const stored = window.localStorage.getItem("mainline-watchlist");
    if (stored) {
      try { setWatchlist(JSON.parse(stored)); } catch { /* keep defaults */ }
    }
    const storedStocks = window.localStorage.getItem("mainline-stock-codes");
    let initialStocks = stockCodes;
    if (storedStocks) {
      try {
        const parsed = JSON.parse(storedStocks);
        if (Array.isArray(parsed)) {
          initialStocks = parsed;
          setStockCodes(parsed);
          stockCodesRef.current = parsed;
        }
      } catch { /* keep defaults */ }
    }
    void fetchMarket();
    void fetchStocks(initialStocks);
    void fetchHistory();
    void fetchSignals();
    const marketInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchMarket();
      }
    }, 20_000);
    const stockInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchStocks(stockCodesRef.current);
      }
    }, 20_000);
    const countdown = window.setInterval(() => {
      setNowMs(Date.now());
      setSecondsLeft((current) => current <= 1 ? 20 : current - 1);
    }, 1_000);
    return () => {
      window.clearInterval(marketInterval);
      window.clearInterval(stockInterval);
      window.clearInterval(countdown);
      window.removeEventListener("hashchange", onHashChange);
    };
    // stockCodes is intentionally restored once; later refreshes use stockCodesRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchHistory, fetchMarket, fetchSignals, fetchStocks]);

  const switchView = (view: View) => {
    setActiveView(view);
    window.history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleWatch = (id: string) => {
    setWatchlist((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      window.localStorage.setItem("mainline-watchlist", JSON.stringify(next));
      return next;
    });
  };

  const refresh = () => {
    void fetchMarket();
    void fetchStocks(stockCodes);
  };

  const addStock = () => {
    const code = stockInput.trim();
    if (!/^\d{6}$/.test(code)) {
      setStockError("请输入6位A股代码，例如 002980");
      return;
    }
    if (stockCodes.includes(code)) {
      setStockError("该股票已在观察池中");
      return;
    }
    const next = [...stockCodes, code];
    setStockCodes(next);
    stockCodesRef.current = next;
    setStockInput("");
    setStockError("");
    window.localStorage.setItem("mainline-stock-codes", JSON.stringify(next));
    void fetchStocks(next);
  };

  const removeStock = (code: string) => {
    const next = stockCodes.filter((item) => item !== code);
    setStockCodes(next);
    stockCodesRef.current = next;
    setStockQuotes((current) => current.filter((item) => item.code !== code));
    window.localStorage.setItem("mainline-stock-codes", JSON.stringify(next));
  };

  const strongest = [...effectiveSectors]
    .sort((a, b) => {
      const qualificationGap = Number(isMainlineQualified(b)) - Number(isMainlineQualified(a));
      return qualificationGap || b.score - a.score;
    })[0] ?? unavailableSector;
  const newest = effectiveSectors.find((sector) => sector.phase === "启动") ?? effectiveSectors[1] ?? strongest;
  const secondCandidate = effectiveSectors.filter((sector) => sector.id !== strongest.id && sector.id !== newest.id)[0] ?? newest;
  const riskiest = [...effectiveSectors].sort((a, b) => a.score - b.score)[0] ?? strongest;
  const marketAmount = indices.reduce((sum, item) => sum + (item.amount || 0), 0) / 100_000_000;
  const defaultStockNames: Record<string, string> = {
    "002980": "华盛昌",
    "601606": "长城军工",
    "002265": "建设工业",
    "301392": "汇成真空",
  };
  const displayedStocks = stockCodes.map((code) => stockQuotes.find((item) => item.code === code) ?? {
    code,
    name: defaultStockNames[code] || "行情待获取",
    price: 0,
    change: 0,
    changeValue: 0,
    open: 0,
    high: 0,
    low: 0,
    volume: 0,
    amount: 0,
    turnover: 0,
    flow: 0,
  });
  const checks = confirmationChecks(selected);
  const passedChecks = checks.filter((item) => item.status === "pass").length;
  const earlyCandidates = effectiveSectors
    .filter((sector) => sector.flow > 0 && sector.breadth >= 42 && sector.score >= 50 && sector.phase !== "退潮")
    .map((sector) => {
      const accelerationPenalty = sector.streak >= 3 ? 16 : 0;
      const chasePenalty = sector.leaderChange >= 9.5 ? 18 : sector.leaderChange >= 7 ? 8 : 0;
      const opportunity = Math.round(Math.max(0, Math.min(100,
        sector.score * .35
        + Math.min(85, 50 + sector.flow * 1.4) * .25
        + sector.breadth * .2
        + Math.min(85, 45 + sector.leaderChange * 4) * .2
        - accelerationPenalty
        - chasePenalty
      )));
      const stage = sector.phase === "加速" || sector.streak >= 3 || sector.score >= 85
        ? "已加速"
        : sector.streak === 2
          ? "首次确认"
        : sector.phase === "启动" && sector.leaderChange >= 3
          ? "首板观察"
          : "潜伏异动";
      return { sector, opportunity, stage };
    })
    .sort((a, b) => b.opportunity - a.opportunity);
  const earlyPick = earlyCandidates.find((item) => item.stage !== "已加速") ?? earlyCandidates[0];
  // A broad first-day rebound after a washout can be valuable to record, but
  // it is not promoted to a buy prompt without the existing two-day and
  // leader-support confirmation. This preserves the anti-chase gate while
  // giving the next session's review an auditable recovery candidate.
  const recoveryCandidates = effectiveSectors
    .filter((sector) => isMainlineQualified(sector)
      && sector.streak === 1
      && sector.phase === "启动"
      && sector.score >= 80
      && sector.change >= 3
      && sector.flow > 0
      && sector.breadth >= 80)
    .map((sector) => ({
      sector,
      score: Math.round(Math.min(100, sector.score * .45 + sector.breadth * .25 + Math.min(90, 50 + sector.flow) * .3)),
    }))
    .sort((left, right) => right.score - left.score);
  const recoveryPick = recoveryCandidates[0];
  const hasRecoveryObservation = Boolean(recoveryPick) && isTradingTime && modelReady;
  const firstConfirmedPick = earlyCandidates.find((item) =>
    item.stage !== "已加速" && item.sector.streak === 2
  );
  // Restore the earlier, more responsive entry window without restoring
  // high-chase prompts: a first-day probe needs stronger breadth and score,
  // an advancing (not limit-up) leader, and a real sector move. The normal
  // two-day confirmation remains the preferred path.
  const firstDayProbePick = earlyCandidates.find((item) =>
    item.stage === "首板观察"
    && item.sector.streak === 1
    && item.sector.score >= 72
    && item.sector.change >= 1.5
    && item.sector.breadth >= 65
    && item.sector.flow > 0
    && item.sector.leaderChange >= 3
    && item.sector.leaderChange < 8.5
    && item.opportunity >= 62
  );
  const tradePick = firstConfirmedPick ?? firstDayProbePick;
  const hasTradeSignal = Boolean(tradePick)
    && isTradingTime
    && modelReady
    && tradePick!.stage !== "已加速"
    && tradePick!.opportunity >= 58
    && tradePick!.sector.flow > 0
    && tradePick!.sector.breadth >= 50
    && tradePick!.sector.leaderChange >= 2
    && tradePick!.sector.leaderChange < 9.5;
  const alertSector = hasTradeSignal && tradePick ? tradePick.sector : strongest;
  const addCandidates = displayedStocks.flatMap((stock) => {
    const sector = effectiveSectors.find((item) =>
      item.leader === stock.name || item.stocks.some((member) => member.code === stock.code)
    );
    if (!sector || stock.price <= 0 || stock.high <= stock.low) return [];
    const recovery = (stock.price - stock.low) / (stock.high - stock.low);
    const score = Math.round(Math.max(0, Math.min(100,
      sector.score * .38
      + sector.breadth * .2
      + Math.min(90, 45 + sector.flow * 1.2) * .18
      + Math.min(90, stock.turnover * 4) * .12
      + recovery * 100 * .12
    )));
    const qualified = isTradingTime
      && modelReady
      && isMainlineQualified(sector)
      && (sector.phase === "启动" || sector.phase === "分歧")
      && sector.streak >= 2
      && sector.breadth >= 60
      && stock.change >= -2
      && stock.change <= 5
      && stock.price >= stock.open
      && stock.flow > 0
      && stock.turnover >= 3
      && stock.turnover <= 18
      && recovery >= .62
      && score >= 70;
    return [{ stock, sector, recovery, score, qualified }];
  }).sort((a, b) => b.score - a.score);
  const addPick = addCandidates.find((item) => item.qualified) ?? addCandidates[0];
  const hasAddSignal = Boolean(addPick?.qualified);
  const tradeDateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(quoteTimestamp || nowMs));
  const currentEvent = hasAddSignal && addPick
    ? {
        eventKey: `${tradeDateKey}:add:${addPick.stock.code}`,
        signalType: "add" as const,
        stockCode: addPick.stock.code,
        stockName: addPick.stock.name,
        sectorName: addPick.sector.name,
        score: addPick.score,
        summary: `${addPick.sector.name}连续确认，${addPick.stock.name}回踩后承接转强，符合小仓分批加仓观察条件。`,
        payload: { stock: addPick.stock, sector: addPick.sector, recovery: addPick.recovery },
      }
    : hasTradeSignal && tradePick
      ? {
          eventKey: `${tradeDateKey}:early:${tradePick.sector.id}`,
          signalType: "early" as const,
          stockCode: tradePick.sector.leaderCode || "000000",
          stockName: tradePick.sector.leader,
          sectorName: tradePick.sector.name,
          score: tradePick.opportunity,
          summary: `${tradePick.sector.name}${tradePick.sector.streak === 1 ? "出现首日启动" : "进入首次确认"}，${tradePick.sector.leader}出现早期观察信号。`,
          payload: { sector: tradePick.sector },
        }
      : hasRecoveryObservation && recoveryPick
        ? {
            eventKey: `${tradeDateKey}:recovery:${recoveryPick.sector.id}`,
            signalType: "recovery" as const,
            stockCode: recoveryPick.sector.leaderCode || "000000",
            stockName: recoveryPick.sector.leader,
            sectorName: recoveryPick.sector.name,
            score: recoveryPick.score,
            summary: `${recoveryPick.sector.name}出现首日强修复，已留痕；龙头未完成换手与连续性确认，不构成追涨提示。`,
            payload: { sector: recoveryPick.sector },
          }
      : null;

  useEffect(() => {
    if (!currentEvent || lastSignalRef.current === currentEvent.eventKey) return;
    lastSignalRef.current = currentEvent.eventKey;
    void fetch("/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...currentEvent,
        tradeDate: tradeDateKey,
        triggeredAt: quoteTimestamp || new Date().toISOString(),
      }),
    }).then(() => fetchSignals()).catch(() => undefined);
  }, [currentEvent, fetchSignals, quoteTimestamp, tradeDateKey]);
  const firstHistoryPayload = historySnapshot
    ? JSON.parse(historySnapshot.first_payload) as MarketPayload
    : null;
  const latestHistoryPayload = historySnapshot
    ? JSON.parse(historySnapshot.latest_payload) as MarketPayload
    : null;
  const firstHistoryMainline = firstHistoryPayload?.sectors?.find(isMainlineQualified)
    ?? firstHistoryPayload?.sectors?.[0];
  const latestHistoryMainline = latestHistoryPayload?.sectors?.find(isMainlineQualified)
    ?? latestHistoryPayload?.sectors?.[0];
  const openEvidence = () => {
    setSelectedId(alertSector.id);
    switchView("mainline");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        evidenceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        evidenceRef.current?.focus({ preventScroll: true });
      });
    });
  };

  return (
    <main className="site-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <strong>主线雷达</strong>
            <span>MAINLINE RADAR</span>
          </div>
        </div>
        <nav className="nav-tabs" aria-label="主导航">
          <button className={activeView === "mainline" ? "active" : ""} onClick={() => switchView("mainline")}>主线监测</button>
          <button className={activeView === "funds" ? "active" : ""} onClick={() => switchView("funds")}>资金追踪</button>
          <button className={activeView === "stocks" ? "active" : ""} onClick={() => switchView("stocks")}>个股观察</button>
        </nav>
        <div className="header-actions">
          <span className="market-status"><i /> {source === "eastmoney" ? "实时行情" : source === "delayed" ? "延迟行情" : "行情暂停"}</span>
          <span className="countdown">{secondsLeft}s</span>
          <button className={`refresh-btn ${loading ? "done" : ""}`} onClick={refresh} disabled={loading}>
            {loading ? "更新中…" : "立即刷新"}
          </button>
        </div>
      </header>

      <section className="market-strip">
        {indices.slice(0, 2).map((item) => (
          <div key={item.code}>
            <span>{item.name}</span>
            <strong>{item.price.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            <em className={item.change >= 0 ? "up" : "down"}>{item.change >= 0 ? "+" : ""}{item.change.toFixed(2)}%</em>
          </div>
        ))}
        <div><span>两市成交</span><strong>{marketAmount > 0 ? `${marketAmount.toFixed(0)}亿` : "读取中"}</strong><em>东财</em></div>
        <div><span>主线数量</span><strong>{analysisReady ? effectiveSectors.filter(isMainlineQualified).length : "—"}</strong><em>{closeReviewReady ? "收盘复盘" : auctionReady ? "竞价预判" : analysisReady ? "通过硬门槛" : "模型暂停"}</em></div>
        <div><span>自动刷新</span><strong>板块20秒</strong><em className="up">个股20秒</em></div>
        <p><b className="trade-date">交易日期 {formatTradeDate(quoteTimestamp)}</b> · {closeReviewReady ? "当日收盘复盘" : lunchReviewReady ? "午间复盘" : auctionReady ? "集合竞价监测" : source === "eastmoney" ? "东方财富行情" : source === "delayed" ? `延迟${delayLabel}` : "行情暂停"} · 行情截至 {formatUpdateTime(quoteTimestamp)} · 抓取 {formatUpdateTime(updatedAt).split(" ").at(-1)}</p>
      </section>

      <section className={`trade-alert ${hasTradeSignal ? "signal-on" : "signal-off"}`} aria-live="polite">
        <div className="trade-alert-label">
          <i />
          <span>当前交易提示</span>
        </div>
        <div className="trade-alert-main">
          <strong>{hasTradeSignal
            ? `${alertSector.leader} 出现早期观察信号`
            : auctionReady
              ? `${isAuctionObserve ? "竞价观察" : isAuctionLocked ? "竞价锁单" : "竞价预判"}｜开盘承接后再确认`
            : closeReviewReady
              ? "收盘复盘｜保留当日最后有效判断"
              : lunchReviewReady
                ? "午间复盘｜等待下午开盘确认"
              : !isTradingTime
                ? "休市中｜等待下个交易时段确认"
              : !modelReady
                ? "行情数据异常｜暂不买入"
                : earlyPick?.stage === "已加速"
                  ? `${strongest.leader} 已加速｜龙头确认但不宜追高`
                  : "暂无低风险早期买点"}</strong>
          <p>{hasTradeSignal
            ? `${alertSector.name}刚进入启动窗口，主力净流入${alertSector.flow.toFixed(2)}亿，上涨家数占比${alertSector.breadth}%，龙头涨幅${alertSector.leaderChange.toFixed(2)}%。这是进入观察池的信号，等待换手承接后再小仓试错。`
            : auctionReady
              ? `${strongest.name}竞价结构暂时领先，龙头候选为${strongest.leader}。竞价阶段只形成候选，不生成买入提示；09:30后必须继续验证板块扩散、龙头换手承接与前排同步。`
            : closeReviewReady
              ? `今日收盘主线：${strongest.name}；收盘龙头：${strongest.leader}。当前为复盘数据，只用于核对模型与制定次日观察条件，不生成盘后买入信号。`
              : lunchReviewReady
                ? `上午主线：${strongest.name}；龙头候选：${strongest.leader}。午休期间保留11:30结构供复盘，不生成买入信号，13:00后重新确认资金与承接。`
              : !isTradingTime
                ? `最近识别主线：${strongest.name}；已确认龙头：${strongest.leader}。休市期间不生成买入信号，开盘后优先寻找尚未加速的新候选。`
              : !modelReady
                ? hasDisplayData
                  ? `当前展示最后一次有效行情，数据已延迟${delayLabel}；超过2分30秒后模型不会触发买入提示。`
                  : "尚未取得有效实时行情；主线、龙头和买点模型均已暂停。"
                : earlyPick?.stage === "已加速"
                  ? `${strongest.name}已进入加速阶段，继续追涨的赔率下降。系统将优先寻找首日流入、刚扩散、龙头尚未涨停的新方向。`
                  : "候选板块仍缺少资金、扩散或龙头同步信号，继续等待。"} </p>
        </div>
        <div className="trade-alert-metrics">
          <span><small>监测方向</small><b>{alertSector.name}</b></span>
          <span><small>机会分</small><b>{earlyPick?.opportunity ?? "—"}</b></span>
          <span><small>阶段</small><b>{earlyPick?.stage ?? "等待"}</b></span>
        </div>
        <button onClick={openEvidence} aria-controls="signal-evidence">
          查看依据
        </button>
      </section>

      <section className={`recovery-alert ${hasRecoveryObservation ? "signal-on" : "signal-off"}`} aria-live="polite">
        <div className="trade-alert-label">
          <i />
          <span>强修复观察</span>
        </div>
        <div className="trade-alert-main">
          <strong>{hasRecoveryObservation && recoveryPick
            ? `${recoveryPick.sector.name} 出现首日强修复｜已留痕`
            : "暂无首日强修复观察"}</strong>
          <p>{hasRecoveryObservation && recoveryPick
            ? `板块涨${recoveryPick.sector.change.toFixed(2)}%、资金净流入${recoveryPick.sector.flow.toFixed(2)}亿、上涨扩散率${recoveryPick.sector.breadth}%。这仅记录反转候选；若龙头已涨停或未完成换手，仍不生成买入提示，等待首次健康分歧后的承接确认。`
            : "仅记录首日出现资金、广度与强度同步修复的方向；不替代两日连续确认，也不会在龙头封板后提示追涨。"}</p>
        </div>
        <div className="trade-alert-metrics">
          <span><small>观察方向</small><b>{recoveryPick?.sector.name ?? "等待"}</b></span>
          <span><small>修复评分</small><b>{recoveryPick?.score ?? "—"}</b></span>
          <span><small>后续条件</small><b>换手确认</b></span>
        </div>
        <button onClick={openEvidence}>查看依据</button>
      </section>

      <section className={`add-alert ${hasAddSignal ? "signal-on" : "signal-off"}`} aria-live="polite">
        <div className="trade-alert-label">
          <i />
          <span>可加仓监测</span>
        </div>
        <div className="trade-alert-main">
          <strong>{hasAddSignal && addPick
            ? `${addPick.stock.name} 出现分批加仓观察信号`
            : !isTradingTime
              ? "休市中｜等待盘中回踩确认"
              : !modelReady
                ? "行情数据异常｜暂停加仓判断"
                : "暂无符合条件的加仓信号"}</strong>
          <p>{hasAddSignal && addPick
            ? `${addPick.sector.name}已连续确认且扩散率${addPick.sector.breadth}%；${addPick.stock.name}换手${addPick.stock.turnover.toFixed(2)}%，从日内低点修复${Math.round(addPick.recovery * 100)}%，价格重新站上开盘价并有资金承接。仅适合小仓、分批，不用于下跌摊平。`
            : "需同时满足：所属主线连续确认、板块扩散率≥60%、个股回踩后站回开盘价、资金转正、换手充分且未进入高位加速。任一条件不足都继续等待。"}</p>
        </div>
        <div className="trade-alert-metrics">
          <span><small>监测个股</small><b>{addPick?.stock.name ?? "观察池"}</b></span>
          <span><small>加仓评分</small><b>{addPick?.score ?? "—"}</b></span>
          <span><small>记录状态</small><b>{hasAddSignal ? "已留痕" : "等待"}</b></span>
        </div>
        <button onClick={() => switchView("stocks")}>查看个股</button>
      </section>

      {signalEvents.length > 0 && (
        <section className="signal-ledger">
          <div>
            <span>信号留痕</span>
            <strong>最近触发记录</strong>
          </div>
          {signalEvents.slice(0, 3).map((event) => (
            <article key={event.event_key}>
              <span>{event.signal_type === "add" ? "加仓观察" : event.signal_type === "recovery" ? "强修复观察" : "早期买点"} · {formatUpdateTime(event.triggered_at).split(" ").at(-1)}</span>
              <strong>{event.stock_name} · {event.sector_name}</strong>
              <small>评分 {event.score}｜{event.summary}</small>
            </article>
          ))}
        </section>
      )}

      <div className="content">
        <div className="mobile-tabs" aria-label="移动端主导航">
          <button className={activeView === "mainline" ? "active" : ""} onClick={() => switchView("mainline")}>主线</button>
          <button className={activeView === "funds" ? "active" : ""} onClick={() => switchView("funds")}>资金</button>
          <button className={activeView === "stocks" ? "active" : ""} onClick={() => switchView("stocks")}>个股</button>
        </div>
        {activeView === "mainline" && <>
        <section className="auction-panel">
          <div>
            <span className="section-kicker">OPENING AUCTION</span>
            <h2>集合竞价监测</h2>
            <p>09:15–09:20只观察撤单风险；09:20起保存锁单快照；09:25形成开盘预判；09:30后由真实成交确认。</p>
          </div>
          <div className="auction-steps">
            <span className={isAuctionObserve ? "active" : ""}><b>09:15</b>观察，不定性</span>
            <span className={isAuctionLocked ? "active" : ""}><b>09:20</b>锁单快照</span>
            <span className={isAuctionPreview ? "active" : ""}><b>09:25</b>竞价预判</span>
            <span className={isTradingTime ? "active" : ""}><b>09:30</b>承接确认</span>
          </div>
          <strong>{auctionReady
            ? `${strongest.name}｜${strongest.leader}｜仅列候选`
            : isAuctionWindow
              ? "竞价行情不完整，暂停预判"
              : "竞价快照会写入每日复盘记录"}</strong>
        </section>
        <section className="history-review">
          <div className="history-head">
            <div>
              <span className="section-kicker">DAILY REVIEW</span>
              <h2>每日判断记录</h2>
              <p>保存当天首次识别与最新判断，第二天可直接核对主线和龙头是否判断正确。</p>
            </div>
            <label>
              <span>复盘日期</span>
              <select value={historyDate} onChange={(event) => {
                setHistoryDate(event.target.value);
                void fetchHistory(event.target.value);
              }} disabled={!historyDates.length}>
                {!historyDates.length && <option value="">记录从今天开始</option>}
                {historyDates.map((item) => <option key={item.trade_date} value={item.trade_date}>{item.trade_date}</option>)}
              </select>
            </label>
          </div>
          {historySnapshot && firstHistoryMainline && latestHistoryMainline ? (
            <div className="history-compare">
              <article>
                <span>{firstHistoryPayload?.session === "auction" ? "竞价首次识别" : "当日首次识别"} · {formatUpdateTime(historySnapshot.first_captured_at).split(" ").at(-1)}</span>
                <strong>{firstHistoryMainline.name}</strong>
                <p>龙头 {firstHistoryMainline.leader}</p>
                <b>评分 {firstHistoryMainline.score} · {firstHistoryMainline.phase}</b>
              </article>
              <i>→</i>
              <article>
                <span>当日最新判断 · {formatUpdateTime(historySnapshot.latest_captured_at).split(" ").at(-1)}</span>
                <strong>{latestHistoryMainline.name}</strong>
                <p>龙头 {latestHistoryMainline.leader}</p>
                <b>评分 {latestHistoryMainline.score} · {latestHistoryMainline.phase}</b>
              </article>
              <div className="history-verdict">
                <span>一致性</span>
                <strong>{firstHistoryMainline.id === latestHistoryMainline.id ? "主线保持一致" : "盘中主线发生切换"}</strong>
                <p>已记录 {historySnapshot.sample_count} 次样本；次日可结合实际涨跌验证。</p>
              </div>
            </div>
          ) : (
            <div className="history-empty">{historyLoading ? "正在读取历史记录…" : "历史记录从本次升级后开始积累；获得实时东财行情后会自动保存。"}</div>
          )}
        </section>

        <section className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow"><span>市场结论</span> {closeReviewReady ? "收盘结构复盘" : lunchReviewReady ? "午间结构复盘" : analysisReady ? "实时结构分析" : "行情异常 · 模型暂停"}</div>
            <h1>{analysisReady ? <>{strongest.name}领先，<br /><b>{newest.name}进入启动窗口</b></> : <>实时数据不完整，<br /><b>不生成主线与龙头判断</b></>}</h1>
            <p>监测台每20秒更新板块资金、涨跌幅、上涨家数与领涨股；个股行情每20秒更新。行情中断时保留最后一次有效数据，超过2分30秒自动暂停买点模型。</p>
          </div>
          <div className="radar-score">
            <div className="score-ring">
              <span>主线温度</span>
              <strong>{analysisReady ? Math.round(effectiveSectors.slice(0, 5).reduce((sum, item) => sum + item.score, 0) / Math.max(effectiveSectors.slice(0, 5).length, 1)) : "—"}</strong>
              <small>/ 100</small>
            </div>
            <div className="score-meta">
              <span><i className="good" /> 进攻方向 {analysisReady ? effectiveSectors.filter((item) => item.phase === "启动" || item.phase === "加速").length : "—"}</span>
              <span><i className="warn" /> 观察方向 {analysisReady ? effectiveSectors.filter((item) => item.phase === "观察" || item.phase === "分歧").length : "—"}</span>
              <span><i className="bad" /> 退潮方向 {analysisReady ? effectiveSectors.filter((item) => item.phase === "退潮").length : "—"}</span>
            </div>
          </div>
          <div className="hero-alert">
            <span>下一交易日关键</span>
            <strong>{analysisReady ? `${newest.name}能否连续获得资金承接` : "等待完整实时行情恢复"}</strong>
            <p>启动方向需要至少连续两次刷新保持资金净流入，且领涨股不能明显掉队。</p>
          </div>
        </section>

        <section className="summary-grid">
          <article>
            <span>最强主线</span>
            <strong>{strongest.name}</strong>
            <em className="up">评分 {strongest.score} ↑</em>
          </article>
          <article>
            <span>新启动</span>
            <strong>{newest.name}</strong>
            <em className="amber">{newest.flow >= 0 ? "+" : ""}{newest.flow.toFixed(2)}亿</em>
          </article>
          <article>
            <span>第二候选</span>
            <strong>{secondCandidate.name}</strong>
            <em className="amber">评分 {secondCandidate.score}</em>
          </article>
          <article>
            <span>风险方向</span>
            <strong>{riskiest.name}</strong>
            <em className="down">评分 {riskiest.score} ↓</em>
          </article>
        </section>

        <section className="early-radar">
          <div className="early-radar-head">
            <div><span className="section-kicker">EARLY LEADER RADAR</span><h2>潜在龙头雷达</h2></div>
            <p>优先找“刚流入、刚扩散、尚未加速”，已连续涨停的龙头会被降分。</p>
          </div>
          <div className="early-grid">
            {earlyCandidates.slice(0, 3).map(({ sector, opportunity, stage }) => (
              <button key={sector.id} className={stage === "已加速" ? "late" : "early"} onClick={() => setSelectedId(sector.id)}>
                <div><span className={`early-stage ${stage === "已加速" ? "late" : ""}`}>{stage}</span><b>{opportunity}</b></div>
                <h3>{sector.leader}</h3>
                <p>{sector.name} · 评分 {sector.score}</p>
                <ul>
                  <li><span>资金</span><b className="up">+{sector.flow.toFixed(2)}亿</b></li>
                  <li><span>扩散</span><b>{sector.breadth}%</b></li>
                  <li><span>龙头涨幅</span><b className={sector.leaderChange >= 9.5 ? "down" : "up"}>{sector.leaderChange >= 0 ? "+" : ""}{sector.leaderChange.toFixed(2)}%</b></li>
                </ul>
                <strong>{stage === "已加速" ? "风险：不建议盲目追高" : "动作：加入观察，等待承接"}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="tool-shortcuts">
          <button onClick={() => switchView("funds")}>
            <span>资金追踪</span><strong>查看板块净流入与资金动作</strong><em>打开 →</em>
          </button>
          <button onClick={() => switchView("stocks")}>
            <span>个股观察</span><strong>添加股票并跟踪价格与资金</strong><em>打开 →</em>
          </button>
        </section>

        <section className="workspace">
          <div className="table-panel">
            <div className="panel-head">
              <div>
                <span className="section-kicker">SECTOR PULSE</span>
                <h2>板块强度排行</h2>
              </div>
              <div className="filters">
                <label className="search">
                  <span>⌕</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索板块或龙头" aria-label="搜索板块或龙头" />
                </label>
                <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序方式">
                  <option value="score">按评分</option>
                  <option value="flow">按资金</option>
                  <option value="change">按涨幅</option>
                </select>
              </div>
            </div>

            <div className="phase-tabs">
              {phases.map((phase) => (
                <button key={phase} className={activePhase === phase ? "active" : ""} onClick={() => setActivePhase(phase)}>
                  {phase}
                </button>
              ))}
            </div>

            <div className="sector-table" role="table" aria-label="板块强度排行">
              <div className="table-row table-header" role="row">
                <span>排名 / 板块</span><span>阶段</span><span>强度</span><span>当日</span><span>主力净流入</span><span>趋势</span>
              </div>
              {visible.map((sector, index) => (
                <button className={`table-row ${selected.id === sector.id ? "selected" : ""}`} key={sector.id} onClick={() => setSelectedId(sector.id)} role="row">
                  <span className="sector-name">
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    <span><strong>{sector.name}</strong><small>{sector.category ?? "产业主线"} · {sector.code} · {sector.leader}</small></span>
                  </span>
                  <span><b className={phaseClass(sector.phase)}>{sector.phase}</b></span>
                  <span className="score-cell"><strong>{sector.score}</strong><i><em style={{ width: `${sector.score}%` }} /></i></span>
                  <span className={sector.change >= 0 ? "up" : "down"}>{sector.change >= 0 ? "+" : ""}{sector.change.toFixed(2)}%</span>
                  <span className={sector.flow >= 0 ? "up" : "down"}>{sector.flow >= 0 ? "+" : ""}{sector.flow.toFixed(2)}亿</span>
                  <span className={sector.trend.at(-1)! >= sector.trend[0] ? "up" : "down"}><Sparkline values={sector.trend} /></span>
                </button>
              ))}
              {visible.length === 0 && <div className="empty">没有符合条件的板块</div>}
            </div>
          </div>

          <aside
            className="detail-panel"
            id="signal-evidence"
            ref={evidenceRef}
            tabIndex={-1}
          >
            <div className="detail-head">
              <div>
                <span className="section-kicker">SIGNAL DETAIL</span>
                <h2>{selected.name}</h2>
              </div>
              <button className={watchlist.includes(selected.id) ? "watching" : ""} onClick={() => toggleWatch(selected.id)} aria-label="加入或移出观察池">
                {watchlist.includes(selected.id) ? "★ 已关注" : "☆ 关注"}
              </button>
            </div>

            <div className="detail-score">
              <div><span>主线评分</span><strong>{selected.score}</strong><small>/100</small></div>
              <span className={phaseClass(selected.phase)}>{selected.phase}阶段</span>
            </div>

            <div className="factor-grid">
              <div><span>赚钱效应</span><strong>{selected.breadth}</strong><i><em style={{ width: `${selected.breadth}%` }} /></i></div>
              <div><span>资金强度</span><strong>{Math.min(96, Math.max(18, Math.round(50 + selected.flow * 1.2)))}</strong><i><em style={{ width: `${Math.min(96, Math.max(18, 50 + selected.flow * 1.2))}%` }} /></i></div>
              <div><span>持续性</span><strong>{selected.streak > 0 ? 48 + selected.streak * 12 : 22}</strong><i><em style={{ width: `${selected.streak > 0 ? 48 + selected.streak * 12 : 22}%` }} /></i></div>
            </div>

            <div className="signal-box positive detailed-signal">
              <div className="signal-title">
                <span>确认信号明细</span>
                <b>{passedChecks}/{checks.length} 项满足</b>
              </div>
              <p className="signal-summary">{selected.signal}</p>
              <div className="check-list">
                {checks.map((item) => (
                  <div className={`check-item ${item.status}`} key={item.label}>
                    <i>{item.status === "pass" ? "✓" : item.status === "wait" ? "·" : "!"}</i>
                    <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                    <b>{item.value}</b>
                  </div>
                ))}
              </div>
              <div className="next-confirm">
                <strong>下一步确认</strong>
                <p>{selected.phase === "启动"
                  ? "下一交易日资金需继续净流入，板块涨幅保持为正，且领涨股不能明显掉队；满足后才从“启动”升级为“加速”。"
                  : selected.phase === "加速"
                    ? "观察放量后能否维持上涨家数与龙头封锁强度；若资金转负且龙头炸板，阶段将降为“分歧”。"
                    : selected.phase === "分歧"
                      ? "需要资金重新转为净流入、上涨家数恢复至60%以上，并由龙头率先修复，才能判断分歧转一致。"
                      : "至少需要连续两次资金转正、板块指数止跌和明确领涨股出现，才具备重新确认资格。"}</p>
              </div>
            </div>
            <div className="signal-box negative">
              <span>失效条件</span>
              <p>{selected.risk}</p>
            </div>

            <div className="tags">
              {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>

            <div className="stock-list">
              <div className="stock-list-head"><strong>核心观察池</strong><span>角色 / 状态</span></div>
              {selected.stocks.map((stock) => (
                <div className="stock" key={stock.code}>
                  <span><strong>{stock.name}</strong><small>{stock.code}</small></span>
                  <span><em>{stock.role}</em><b>{stock.state}</b></span>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="bottom-grid">
          <article className="method-card">
            <span className="section-kicker">SCORING MODEL</span>
            <h2>主线判定模型</h2>
            <div className="formula">
              <span><b>38%</b>资金强度</span>
              <span><b>27%</b>赚钱效应</span>
              <span><b>22%</b>板块强度</span>
              <span><b>13%</b>龙头辨识度</span>
            </div>
            <p>评分只反映当日实时结构；连续性是独立硬门槛，不会用单次行情虚构。评分 ≥ 80 仅代表结构较强，仍需至少两个有效交易日快照才能确认主线。</p>
          </article>
          <article className="watch-card">
            <div>
              <span className="section-kicker">MY WATCHLIST</span>
              <h2>我的观察池</h2>
            </div>
            <div className="watch-items">
              {sectorData.filter((sector) => watchlist.includes(sector.id)).map((sector) => (
                <button key={sector.id} onClick={() => setSelectedId(sector.id)}>
                  <span className={phaseClass(sector.phase)}>{sector.phase}</span>
                  <strong>{sector.name}</strong>
                  <em>{sector.score}</em>
                </button>
              ))}
              {watchlist.length === 0 && <p>在右侧详情中加入关注方向。</p>}
            </div>
          </article>
        </section>
        </>}

        {activeView === "funds" && (
          <section className="tool-page">
            {!analysisReady && <div className="service-alert"><b>模型已暂停</b><span>{hasDisplayData ? `当前展示${Math.ceil(dataAgeSeconds / 60)}分钟前的有效板块行情，不生成新的主线、龙头或买点判断。` : "尚未取得有效板块行情，恢复后会自动重新计算。"}</span><button onClick={refresh}>重新获取</button></div>}
            <div className="tool-hero">
              <div><span className="section-kicker">CAPITAL FLOW</span><h1>资金追踪</h1><p>按东方财富主力净流入排序，识别资金正在进攻、试探或撤退的板块。</p></div>
              <div className="tool-stat"><span>净流入板块</span><strong className="up">{sectorData.filter((item) => item.flow > 0).length}</strong><small>共 {sectorData.length} 个监测方向</small></div>
              <div className="tool-stat"><span>最强流入</span><strong>{[...sectorData].sort((a, b) => b.flow - a.flow)[0]?.name}</strong><small className="up">+{Math.max(...sectorData.map((item) => item.flow)).toFixed(2)}亿</small></div>
            </div>
            <div className="fund-layout">
              <article className="fund-card">
                <div className="panel-head"><div><span className="section-kicker">INFLOW RANKING</span><h2>板块资金流向</h2></div><span className="data-note">60秒更新</span></div>
                <div className="fund-list">
                  {[...sectorData].sort((a, b) => b.flow - a.flow).map((sector, index) => {
                    const maxFlow = Math.max(...sectorData.map((item) => Math.abs(item.flow)), 1);
                    return <button key={sector.id} onClick={() => { setSelectedId(sector.id); switchView("mainline"); }}>
                      <i>{String(index + 1).padStart(2, "0")}</i>
                      <span><strong>{sector.name}</strong><small>{sector.phase} · 上涨家数占比 {sector.breadth}%</small></span>
                      <div className="flow-track"><em className={sector.flow >= 0 ? "positive" : "negative"} style={{ width: `${Math.max(4, Math.abs(sector.flow) / maxFlow * 100)}%` }} /></div>
                      <b className={sector.flow >= 0 ? "up" : "down"}>{sector.flow >= 0 ? "+" : ""}{sector.flow.toFixed(2)}亿</b>
                    </button>;
                  })}
                </div>
              </article>
              <aside className="fund-side">
                <span className="section-kicker">ACTION GUIDE</span><h2>资金动作判断</h2>
                <div className="action-item"><b className="up">进攻</b><p>净流入、板块上涨和扩散率同时增强，优先进入主线候选。</p></div>
                <div className="action-item"><b className="amber">试探</b><p>资金转正但扩散不足，需要下一交易日继续确认。</p></div>
                <div className="action-item"><b className="down">撤退</b><p>净流出叠加板块下跌，不把单次反抽当作回流。</p></div>
              </aside>
            </div>
          </section>
        )}

        {activeView === "stocks" && (
          <section className="tool-page">
            {(stockError || stockLoading) && <div className={`service-alert ${stockLoading ? "loading" : ""}`}><b>{stockLoading ? "正在更新" : "行情提示"}</b><span>{stockLoading ? "正在读取东方财富个股行情…" : stockError}</span><button onClick={() => void fetchStocks(stockCodes)} disabled={stockLoading}>{stockLoading ? "请稍候" : "重新获取"}</button></div>}
            <div className="tool-hero stock-hero">
              <div><span className="section-kicker">STOCK WATCH</span><h1>个股观察</h1><p>添加你关心的A股代码，实时查看价格、涨跌、成交额、换手和主力资金。</p></div>
              <div className="stock-adder">
                <label><span>股票代码</span><input value={stockInput} onChange={(event) => setStockInput(event.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(event) => { if (event.key === "Enter") addStock(); }} placeholder="例如 002980" /></label>
                <button onClick={addStock}>＋ 添加观察</button>
              </div>
            </div>
            <article className="stock-board">
              <div className="stock-board-head"><span>股票</span><span>最新价</span><span>涨跌幅</span><span>成交额</span><span>换手率</span><span>主力净流入</span><span>日内区间</span><span /></div>
              {displayedStocks.map((stock) => (
                <div className="quote-row" key={stock.code}>
                  <span><strong>{stock.name}</strong><small>{stock.code}</small></span>
                  <b>{stock.price ? stock.price.toFixed(2) : "—"}</b>
                  <b className={stock.price ? (stock.change >= 0 ? "up" : "down") : ""}>{stock.price ? `${stock.change >= 0 ? "+" : ""}${stock.change.toFixed(2)}%` : "等待行情"}</b>
                  <span>{stock.amount ? (stock.amount >= 100000000 ? `${(stock.amount / 100000000).toFixed(2)}亿` : `${(stock.amount / 10000).toFixed(0)}万`) : "—"}</span>
                  <span>{stock.price ? `${stock.turnover.toFixed(2)}%` : "—"}</span>
                  <span className={stock.price ? (stock.flow >= 0 ? "up" : "down") : ""}>{stock.price ? `${stock.flow >= 0 ? "+" : ""}${(stock.flow / 100000000).toFixed(2)}亿` : "—"}</span>
                  <span>{stock.price ? `${stock.low.toFixed(2)} — ${stock.high.toFixed(2)}` : "—"}</span>
                  <button onClick={() => removeStock(stock.code)} aria-label={`移除${stock.name}`}>移除</button>
                </div>
              ))}
              {!displayedStocks.length && <div className="empty">添加股票代码后开始观察</div>}
            </article>
            <p className="stock-tip">观察池保存在当前浏览器。行情每20秒静默更新，不会改变当前页面位置。{stockUpdatedAt && ` 最近成功更新：${formatUpdateTime(stockUpdatedAt)}`}</p>
          </section>
        )}
      </div>

      <footer>
        <span>主线雷达 · A股资金与情绪监测</span>
          <p>实时数据不完整时模型自动暂停；仅供研究记录，不构成任何投资建议。</p>
      </footer>
    </main>
  );
}
