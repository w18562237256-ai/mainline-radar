"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Phase = "加速" | "启动" | "观察" | "退潮";
type Components = {
  capital: number;
  strength: number;
  breadth: number;
  continuity: number;
  leadership: number;
};
type Theme = {
  id: string;
  name: string;
  matchedBoard: string;
  score: number;
  phase: Phase;
  confirmed: boolean;
  change: number;
  mainNetRatio: number;
  breadth: number;
  netIn: number;
  leaderChange: number;
  trend: { fiveDay: number; twentyDay: number; positiveDays5: number };
  components: Components;
  leaders: { rank: string; name: string; code?: string; change?: number; membershipVerified?: boolean }[];
  signal: string;
  action: string;
  risk: string;
  sessionDate: string;
  displayType?: "主线题材" | "行业板块" | "防御方向";
  driver?: string;
  attribution?: string;
  leaderMode?: "dragon" | "gainers" | "single";
};
type Payload = {
  schemaVersion: 2;
  available: boolean;
  sourceLabel: string;
  sessionDate: string | null;
  updatedAt: string | null;
  market: {
    temperature: number;
    mainlineCount: number;
    conclusion: string;
    strongestThemeId: string | null;
    nextThemeId: string | null;
  };
  themes: Theme[];
  methodology: { name: string; weights: Components; rule: string };
  coverage: { totalBoards: number; deepAnalyzed: number; displayed: number };
};
type IndexQuote = { name: string; value: number; change: number };
type EastmoneyStock = { f12?: string; f14?: string; f3?: number; f6?: number; f109?: number };

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const clamp = (value: number) => Math.min(100, Math.max(0, value));
const phaseClass: Record<Phase, string> = {
  加速: "accelerate",
  启动: "launch",
  观察: "watch",
  退潮: "fade",
};

function jsonp<T>(base: string, params: URLSearchParams, timeout = 8_000) {
  return new Promise<T>((resolve, reject) => {
    const callback = `radar_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    params.set("cb", callback);
    params.set("_", String(Date.now()));
    const callbacks = window as unknown as Record<string, (payload: T) => void>;
    const script = document.createElement("script");
    const timer = window.setTimeout(() => finish(new Error("timeout")), timeout);

    function finish(error?: Error, payload?: T) {
      window.clearTimeout(timer);
      script.remove();
      delete callbacks[callback];
      if (error) reject(error);
      else resolve(payload as T);
    }

    callbacks[callback] = (payload) => finish(undefined, payload);
    script.onerror = () => finish(new Error("network"));
    script.src = `${base}?${params}`;
    document.head.appendChild(script);
  });
}

async function browserLeaders(code: string) {
  try {
    const response = await fetch(`/api/leaders?board=${encodeURIComponent(code)}`, { cache: "no-store" });
    const payload = await response.json() as {
      available?: boolean;
      leaders?: { rank: string; code: string; name: string; change: number; membershipVerified: true }[];
    };
    if (response.ok && payload.available && (payload.leaders?.length ?? 0) >= 2) {
      return payload.leaders!;
    }
  } catch {
    // Try the direct free quote endpoint below.
  }

  const params = new URLSearchParams({
    pn: "1", pz: "100", po: "1", np: "1",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: "2", invt: "2", fid: "f3",
    fs: `b:${code} f:!50`, fields: "f12,f14,f3,f6,f109",
  });
  const payload = await jsonp<{ data?: { diff?: EastmoneyStock[] } }>(
    "https://29.push2.eastmoney.com/api/qt/clist/get",
    params,
  );
  const stocks = (payload.data?.diff ?? []).filter((stock) => stock.f14 && !stock.f14.includes("退"));
  const maxAmount = Math.max(...stocks.map((stock) => Number(stock.f6 ?? 0)), 1);
  const leaders = stocks.map((stock) => ({
    code: String(stock.f12 ?? ""),
    name: String(stock.f14),
    change: Number(stock.f3 ?? 0),
    score: clamp((Number(stock.f109 ?? stock.f3 ?? 0) + 5) * 4) * .45
      + clamp((Number(stock.f3 ?? 0) + 3) * 7.7) * .25
      + (Number(stock.f6 ?? 0) / maxAmount) * 30,
  })).sort((a, b) => b.score - a.score).slice(0, 2)
    .map((stock, index) => ({
      rank: index ? "龙二" : "龙一",
      code: stock.code,
      name: stock.name,
      change: stock.change,
      membershipVerified: true,
    }));
  if (leaders.length < 2) throw new Error("insufficient constituents");
  return leaders;
}

async function browserIndexes() {
  const params = new URLSearchParams({
    fltt: "2", invt: "2", fields: "f2,f3,f14",
    secids: "1.000001,0.399001",
  });
  const payload = await jsonp<{ data?: { diff?: { f14?: string; f2?: number; f3?: number }[] } }>(
    "https://push2.eastmoney.com/api/qt/ulist.np/get",
    params,
    6_000,
  );
  return (payload.data?.diff ?? []).map((quote) => ({
    name: String(quote.f14 ?? "指数"),
    value: Number(quote.f2 ?? 0),
    change: Number(quote.f3 ?? 0),
  }));
}

function signed(value: number, suffix = "%") {
  return `${value >= 0 ? "+" : ""}${number.format(value)}${suffix}`;
}

function money(value: number) {
  return `${value >= 0 ? "+" : ""}${number.format(value)}亿`;
}

function emptyPayload(): Payload {
  return {
    schemaVersion: 2,
    available: false,
    sourceLabel: "行情暂时未连接",
    sessionDate: null,
    updatedAt: null,
    coverage: { totalBoards: 0, deepAnalyzed: 0, displayed: 0 },
    market: {
      temperature: 0,
      mainlineCount: 0,
      conclusion: "数据中断 · 暂停判断",
      strongestThemeId: null,
      nextThemeId: null,
    },
    themes: [],
    methodology: {
      name: "主线归因模型 V3",
      weights: { capital: 30, strength: 25, breadth: 20, continuity: 15, leadership: 10 },
      rule: "数据不足时不输出主线结论。",
    },
  };
}

export default function Home() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [indexes, setIndexes] = useState<IndexQuote[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<"全部" | Phase>("全部");
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [countdown, setCountdown] = useState(20);
  const enriching = useRef(false);

  const fillLeaders = useCallback(async (payload: Payload) => {
    if (enriching.current || !payload.available) return;
    const targets = payload.themes
      .filter((theme) => theme.leaderMode === "dragon" && theme.leaders.length < 2)
      .slice(0, 10);
    if (!targets.length) return;
    enriching.current = true;
    for (const theme of targets) {
      try {
        const leaders = await browserLeaders(theme.id);
        setData((current) => current ? {
          ...current,
          themes: current.themes.map((item) => item.id === theme.id ? { ...item, leaders } : item),
        } : current);
      } catch {
        // Continue showing the last verified leader if the free endpoint is unavailable.
      }
    }
    enriching.current = false;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setCountdown(20);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      const payload = await response.json() as Payload;
      setData(payload);
      void fillLeaders(payload);
      void browserIndexes().then(setIndexes).catch(() => undefined);
    } catch {
      setData(emptyPayload());
    } finally {
      setLoading(false);
    }
  }, [fillLeaders]);

  useEffect(() => {
    void Promise.resolve().then(load);
    const refresh = window.setInterval(load, 20_000);
    const tick = window.setInterval(() => setCountdown((value) => value <= 1 ? 20 : value - 1), 1_000);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, [load]);

  const ranked = useMemo(
    () => [...(data?.themes ?? [])].sort((a, b) => b.score - a.score),
    [data],
  );
  const strongest = ranked.find((theme) => theme.id === data?.market.strongestThemeId) ?? ranked[0];
  const nextTheme = ranked.find((theme) => theme.id === data?.market.nextThemeId) ?? ranked[1];
  const filtered = ranked.filter((theme) =>
    (phaseFilter === "全部" || theme.phase === phaseFilter)
    && (!query || `${theme.name}${theme.matchedBoard}${theme.leaders.map((leader) => leader.name).join("")}`.includes(query))
  );
  const visible = showAll ? filtered : filtered.slice(0, 6);
  const topFlow = [...ranked].sort((a, b) => b.netIn - a.netIn)[0];
  const phaseCounts = Object.fromEntries(
    (["加速", "启动", "观察", "退潮"] as Phase[])
      .map((phase) => [phase, ranked.filter((theme) => theme.phase === phase).length]),
  ) as Record<Phase, number>;
  const leaderTitle = (theme: Theme, index: number) =>
    theme.leaderMode === "dragon" ? (index ? "龙二" : "龙一") : (index ? "领涨二" : "领涨一");

  return (
    <main id="top">
      <header className="simple-header">
        <a className="simple-brand" href="#top"><span>M</span><b>主线雷达</b></a>
        <nav>
          <a href="#today">今天</a>
          <a href="#sectors">板块</a>
          <a href="#watch">自选</a>
        </nav>
        <button className="refresh-button" onClick={load} disabled={loading}>
          <i className={data?.available ? "live-dot" : "live-dot off"} />
          {loading ? "刷新中" : `${countdown}s 刷新`}
        </button>
      </header>

      <section className="mini-market">
        {indexes.map((quote) => (
          <div key={quote.name}>
            <span>{quote.name}</span>
            <b>{number.format(quote.value)}</b>
            <em className={quote.change >= 0 ? "positive" : "negative"}>{signed(quote.change)}</em>
          </div>
        ))}
        <div><span>主线温度</span><b>{data?.market.temperature ?? 0}</b><em>/ 100</em></div>
        <div><span>确认主线</span><b>{data?.market.mainlineCount ?? 0}</b><em>个</em></div>
        <div className="market-date"><span>数据日期</span><b>{data?.sessionDate ?? "—"}</b><em>{data?.sourceLabel ?? "等待行情"}</em></div>
      </section>

      <div className="simple-shell">
        <section className="today-grid" id="today">
          <article className="today-main">
            <div className="card-kicker">
              <span>今天先看这个</span>
              {strongest && <i className={`phase-badge ${phaseClass[strongest.phase]}`}>{strongest.phase}</i>}
            </div>
            <h1>{strongest?.name ?? "等待有效行情"}</h1>
            <p className="plain-conclusion">{data?.market.conclusion ?? "数据不足，暂不判断"}</p>

            <div className="leader-line">
              <div><span>{strongest ? leaderTitle(strongest, 0) : "龙一"}</span><b>{strongest?.leaders[0]?.name ?? "暂无"}</b><em>{strongest?.leaders[0]?.change != null ? signed(strongest.leaders[0].change) : strongest ? signed(strongest.leaderChange) : ""}</em></div>
              <div><span>{strongest ? leaderTitle(strongest, 1) : "龙二"}</span><b>{strongest?.leaders[1]?.name ?? "未形成梯队"}</b><em>{strongest?.leaders[1]?.change != null ? signed(strongest.leaders[1].change) : ""}</em></div>
            </div>

            <div className="today-metrics">
              <div><span>共振分</span><b>{strongest?.score ?? "—"}</b></div>
              <div><span>主力资金</span><b className={(strongest?.netIn ?? 0) >= 0 ? "positive" : "negative"}>{strongest ? money(strongest.netIn) : "—"}</b></div>
              <div><span>板块涨幅</span><b>{strongest ? signed(strongest.change) : "—"}</b></div>
              <div><span>上涨扩散</span><b>{strongest ? `${Math.round(strongest.breadth * 100)}%` : "—"}</b></div>
            </div>

            <div className="action-box">
              <span>现在怎么做</span>
              <b>{strongest?.action ?? "等待数据恢复后再判断"}</b>
              <small>{strongest?.risk}</small>
            </div>
          </article>

          <aside className="today-side">
            <div className="temperature-dial" style={{ "--temperature": `${(data?.market.temperature ?? 0) * 3.6}deg` } as React.CSSProperties}>
              <span><b>{data?.market.temperature ?? 0}</b><small>主线温度</small></span>
            </div>
            <div>
              <span className="side-label">下一个看谁</span>
              <h2>{nextTheme?.name ?? "暂无"}</h2>
              <p>{nextTheme ? `${nextTheme.phase} · ${nextTheme.score}分 · 龙一 ${nextTheme.leaders[0]?.name ?? "待确认"}` : "等待新方向"}</p>
            </div>
            <div className="stage-summary">
              <span><i className="launch-dot" />启动 {phaseCounts.启动}</span>
              <span><i className="accelerate-dot" />加速 {phaseCounts.加速}</span>
              <span><i className="watch-dot" />观察 {phaseCounts.观察}</span>
              <span><i className="fade-dot" />退潮 {phaseCounts.退潮}</span>
            </div>
          </aside>
        </section>

        <section className="sector-section" id="sectors">
          <div className="simple-title">
            <div><span>板块排名</span><h2>只看最重要的</h2></div>
            <label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索板块或股票" /></label>
          </div>

          <div className="filter-row">
            {(["全部", "启动", "加速", "观察", "退潮"] as const).map((phase) => (
              <button key={phase} className={phaseFilter === phase ? "active" : ""} onClick={() => setPhaseFilter(phase)}>
                {phase}{phase === "全部" ? "" : ` ${phaseCounts[phase]}`}
              </button>
            ))}
          </div>

          <div className="sector-list">
            {visible.map((theme) => (
              <details className="sector-card" key={theme.id}>
                <summary>
                  <span className="sector-rank">{String(ranked.indexOf(theme) + 1).padStart(2, "0")}</span>
                  <span className="sector-name">
                    <b>{theme.name}</b>
                    <small>
                      {leaderTitle(theme, 0)} {theme.leaders[0]?.name ?? "暂无"} {theme.leaders[0]?.change != null ? signed(theme.leaders[0].change) : ""}
                      {" · "}{leaderTitle(theme, 1)} {theme.leaders[1]?.name ?? "未形成梯队"} {theme.leaders[1]?.change != null ? signed(theme.leaders[1].change) : ""}
                    </small>
                  </span>
                  <i className={`phase-badge ${phaseClass[theme.phase]}`}>{theme.phase}</i>
                  <span className="sector-score"><b>{theme.score}</b><small>共振分</small></span>
                  <span className={`sector-money ${theme.netIn >= 0 ? "positive" : "negative"}`}>{money(theme.netIn)}</span>
                  <span className="detail-link">为什么⌄</span>
                </summary>
                <div className="sector-detail">
                  <div className="factor-grid">
                    {[
                      ["资金", theme.components.capital, "30%"],
                      ["强度", theme.components.strength, "25%"],
                      ["扩散", theme.components.breadth, "20%"],
                      ["持续", theme.components.continuity, "15%"],
                      ["龙头", theme.components.leadership, "10%"],
                    ].map(([label, value, weight]) => (
                      <div key={String(label)}>
                        <span>{label} <small>{weight}</small></span>
                        <b>{value}</b>
                        <i><em style={{ width: `${value}%` }} /></i>
                      </div>
                    ))}
                  </div>
                  {theme.driver && <p><b>当天为什么动：</b>{theme.driver}</p>}
                  {theme.attribution && <p><b>归属校正：</b>{theme.attribution}</p>}
                  <p><b>入选原因：</b>{theme.signal}</p>
                  <p><b>下一步：</b>{theme.action}</p>
                  <p><b>风险：</b>{theme.risk}</p>
                </div>
              </details>
            ))}
          </div>

          {filtered.length > 6 && (
            <button className="show-all" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "收起，只看前6名" : `查看全部 ${filtered.length} 个板块`}
            </button>
          )}
        </section>

        <section className="quick-grid">
          <article>
            <span className="side-label">资金最强</span>
            <h2>{topFlow?.name ?? "等待行情"}</h2>
            <b className="big-money">{topFlow ? money(topFlow.netIn) : "—"}</b>
            <p>{topFlow ? `${topFlow.phase} · 上涨扩散 ${Math.round(topFlow.breadth * 100)}%` : "暂无有效数据"}</p>
          </article>
          <article>
            <span className="side-label">模型怎么判断</span>
            <h2>五项同时变强，才算主线</h2>
            <p>资金30% · 强度25% · 扩散20% · 持续15% · 龙头10%</p>
            <small>不是涨得最多就排第一，也不会把“昨日涨停”当成板块。</small>
          </article>
        </section>

        <section className="watch-section" id="watch">
          <div className="simple-title"><div><span>我的关注</span><h2>一眼看懂个股身份</h2></div></div>
          <div className="watch-cards">
            {["长城军工", "孚日股份"].map((stock) => {
              const theme = ranked.find((item) => item.leaders.some((leader) => leader.name === stock));
              const leaderIndex = theme?.leaders.findIndex((leader) => leader.name === stock) ?? -1;
              return (
                <article key={stock}>
                  <div><h3>{stock}</h3><i className={`phase-badge ${theme ? phaseClass[theme.phase] : "watch"}`}>{theme?.phase ?? "观察"}</i></div>
                  <p>{theme ? `${theme.name} · ${leaderTitle(theme, leaderIndex)} · ${theme.score}分` : "尚未进入主线龙一、龙二名单"}</p>
                  <b>{stock === "孚日股份"
                    ? "行业归属是棉纺，主营是家纺+新材料；本次上涨逻辑是VC添加剂涨价，不是棉纺主线"
                    : theme?.action ?? "继续观察，不提前下结论"}</b>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <nav className="mobile-nav">
        <a href="#today"><span>⌂</span>今天</a>
        <a href="#sectors"><span>▦</span>板块</a>
        <a href="#watch"><span>☆</span>自选</a>
        <button onClick={load}><span>↻</span>刷新</button>
      </nav>

      <footer>
        <b>主线雷达</b>
        <p>公开行情可能延迟或中断，仅供市场研究，不构成投资建议。</p>
        <a href="#top">回到顶部 ↑</a>
      </footer>
    </main>
  );
}
