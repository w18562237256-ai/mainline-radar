"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PeriodLeader = { id: string; name: string; score: number; strength: string };
type Theme = {
  id: string;
  name: string;
  matchedBoard: string;
  boardType?: string;
  scores: { day: number; current: number; mid: number };
  returns: { day: number; fiveDay: number; twentyDay: number };
  breadth: number;
  netIn: number;
  leaders: { rank: string; name: string }[];
  catalyst: string;
  risk: string;
  sessionDate: string;
};
type Payload = {
  available: boolean;
  sourceLabel: string;
  sessionDate: string | null;
  updatedAt: string | null;
  leaders: null | { day: PeriodLeader; current: PeriodLeader; mid: PeriodLeader };
  themes: Theme[];
  method: string;
  coverage?: { totalBoards: number; deepAnalyzed: number; displayed: number };
};
type Phase = "加速" | "启动" | "观察" | "退潮";
type RankedTheme = Theme & { phase: Phase; overall: number };
type IndexQuote = { name: string; value: number; change: number };
type EastmoneyStock = { f14?: string; f3?: number; f6?: number; f109?: number };

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const scale = (value: number, low: number, high: number) => clamp(((value - low) / (high - low)) * 100);
const phaseClass: Record<Phase, string> = { 加速: "accelerate", 启动: "launch", 观察: "watch", 退潮: "fade" };

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
  const params = new URLSearchParams({
    pn: "1", pz: "100", po: "1", np: "1",
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: "2", invt: "2", fid: "f3",
    fs: `b:${code} f:!50`, fields: "f14,f3,f6,f109",
  });
  const payload = await jsonp<{ data?: { diff?: EastmoneyStock[] } }>(
    "https://29.push2.eastmoney.com/api/qt/clist/get",
    params,
  );
  const stocks = (payload.data?.diff ?? []).filter((stock) => stock.f14 && !stock.f14.includes("退"));
  const maxAmount = Math.max(...stocks.map((stock) => Number(stock.f6 ?? 0)), 1);
  const leaders = stocks.map((stock) => ({
    name: String(stock.f14),
    score: scale(Number(stock.f109 ?? stock.f3 ?? 0), -5, 20) * .45
      + scale(Number(stock.f3 ?? 0), -3, 10) * .25
      + (Number(stock.f6 ?? 0) / maxAmount) * 30,
  })).sort((a, b) => b.score - a.score).slice(0, 2)
    .map((stock, index) => ({ rank: index ? "龙二" : "龙一", name: stock.name }));
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

function marketPhase(theme: Theme): Phase {
  const { day, fiveDay } = theme.returns;
  if (day <= -2 || theme.breadth <= .25 || (day < 0 && theme.netIn < 0)) return "退潮";
  if (day >= 2 && fiveDay >= 6 && theme.breadth >= .5 && theme.netIn > 0) return "加速";
  if (day >= 1.2 && theme.breadth >= .55 && theme.netIn > 0) return "启动";
  return "观察";
}

function overallScore(theme: Theme) {
  return Math.round(theme.scores.day * .3 + theme.scores.current * .5 + theme.scores.mid * .2);
}

function signed(value: number, suffix = "%") {
  return `${value >= 0 ? "+" : ""}${number.format(value)}${suffix}`;
}

function money(value: number) {
  return `${value >= 0 ? "+" : ""}${number.format(value)}亿`;
}

function tradingStatus() {
  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (day === 0 || day === 6) return "休市中｜等待下个交易时段确认";
  if (minutes < 9 * 60 + 15) return "盘前准备｜观察竞价与资金方向";
  if (minutes <= 15 * 60) return "交易中｜等待连续刷新确认";
  return "已收盘｜复盘当日主线与龙头";
}

export default function Home() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaderFill, setLeaderFill] = useState<"idle" | "loading" | "done">("idle");
  const [indexes, setIndexes] = useState<IndexQuote[]>([]);
  const [query, setQuery] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<"全部" | Phase>("全部");
  const [sortBy, setSortBy] = useState<"score" | "money" | "gain">("score");
  const [countdown, setCountdown] = useState(20);
  const enriching = useRef(false);

  const fillLeaders = useCallback(async (payload: Payload) => {
    if (enriching.current || !payload.available) return;
    const targets = payload.themes.filter((theme) => theme.leaders.length < 2);
    if (!targets.length) {
      setLeaderFill("done");
      return;
    }
    enriching.current = true;
    setLeaderFill("loading");
    for (const theme of targets) {
      try {
        const leaders = await browserLeaders(theme.id);
        setData((current) => current ? {
          ...current,
          themes: current.themes.map((item) => item.id === theme.id ? { ...item, leaders } : item),
        } : current);
      } catch {
        // Keep the last verified leader when the free browser endpoint is unavailable.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    }
    enriching.current = false;
    setLeaderFill("done");
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
      setData({
        available: false,
        sourceLabel: "行情数据暂时未连接",
        sessionDate: null,
        updatedAt: null,
        leaders: null,
        themes: [],
        method: "数据源中断时暂停判断，不使用旧结论冒充实时结果。",
      });
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

  const ranked = useMemo<RankedTheme[]>(
    () => (data?.themes ?? []).map((theme) => ({
      ...theme,
      phase: marketPhase(theme),
      overall: overallScore(theme),
    })).sort((a, b) => b.overall - a.overall),
    [data],
  );

  const phaseCounts = useMemo(() => ({
    加速: ranked.filter((theme) => theme.phase === "加速").length,
    启动: ranked.filter((theme) => theme.phase === "启动").length,
    观察: ranked.filter((theme) => theme.phase === "观察").length,
    退潮: ranked.filter((theme) => theme.phase === "退潮").length,
  }), [ranked]);

  const visibleThemes = useMemo(() => {
    const filtered = ranked.filter((theme) =>
      (phaseFilter === "全部" || theme.phase === phaseFilter)
      && (!query.trim() || `${theme.name}${theme.matchedBoard}${theme.leaders.map((leader) => leader.name).join("")}`.includes(query.trim())),
    );
    return [...filtered].sort((a, b) => {
      if (sortBy === "money") return b.netIn - a.netIn;
      if (sortBy === "gain") return b.returns.day - a.returns.day;
      return b.overall - a.overall;
    });
  }, [ranked, phaseFilter, query, sortBy]);

  const strongest = ranked[0];
  const launchTheme = ranked.find((theme) => theme.phase === "启动") ?? ranked[1];
  const second = ranked.find((theme) => theme.id !== strongest?.id && theme.id !== launchTheme?.id) ?? ranked[1];
  const riskTheme = ranked.find((theme) => theme.phase === "退潮") ?? ranked.at(-1);
  const temperature = strongest
    ? Math.round(clamp(strongest.overall * .72 + strongest.breadth * 28))
    : 0;
  const confirmed = ranked.filter((theme) => theme.overall >= 58).length;
  const attackCount = phaseCounts.加速 + phaseCounts.启动;
  const marketSummary = temperature >= 70
    ? "主线清晰 · 资金聚焦"
    : temperature >= 55
      ? "弱市聚焦 · 等待扩散"
      : "轮动观察 · 控制追高";
  const earlyLeaders = ranked
    .filter((theme) => theme.leaders[0])
    .sort((a, b) => {
      const phaseWeight = (theme: RankedTheme) => theme.phase === "启动" ? 20 : theme.phase === "观察" ? 10 : 0;
      return (b.overall + phaseWeight(b)) - (a.overall + phaseWeight(a));
    })
    .slice(0, 3);
  const maxFlow = Math.max(...ranked.map((theme) => Math.abs(theme.netIn)), 1);
  const watchStocks = ["长城军工", "孚日股份"];

  return (
    <main className="site-shell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="回到顶部">
          <span>M</span>
          <div><b>主线雷达</b><small>MAINLINE RADAR</small></div>
        </a>
        <nav>
          <a href="#monitor">主线监测</a>
          <a href="#capital">资金追踪</a>
          <a href="#watchlist">个股观察</a>
        </nav>
        <div className="refresh-box">
          <span className={data?.available ? "live-dot" : "live-dot off"} />
          <small>{leaderFill === "loading" ? "补全龙头" : "缓存行情"}</small>
          <b>{countdown}<em>s</em></b>
          <button onClick={load} disabled={loading}>{loading ? "刷新中" : "立即刷新"}</button>
        </div>
      </header>

      <section className="market-strip" aria-label="市场概览">
        {[0, 1].map((index) => {
          const quote = indexes[index];
          return (
            <div className="quote-box" key={index}>
              <span>{quote?.name ?? (index ? "深证成指" : "上证指数")}</span>
              <b>{quote ? number.format(quote.value) : "—"}</b>
              <em className={(quote?.change ?? 0) >= 0 ? "positive" : "negative"}>
                {quote ? signed(quote.change) : "等待行情"}
              </em>
            </div>
          );
        })}
        <div className="quote-box">
          <span>扫描板块</span><b>{data?.coverage?.totalBoards ?? "—"}</b><em>行业＋概念</em>
        </div>
        <div className="quote-box">
          <span>主线数量</span><b>{confirmed}</b><em>评分 ≥ 58</em>
        </div>
        <div className="quote-box">
          <span>自动刷新</span><b>20<small>秒</small></b><em>原地更新</em>
        </div>
        <div className="quote-box date-box">
          <span>交易日期</span><b>{data?.sessionDate?.replaceAll("-", "/") ?? "—"}</b><em>{data?.sourceLabel ?? "等待数据"}</em>
        </div>
      </section>

      <section className="dashboard" id="monitor">
        <div className="trade-alert">
          <div>
            <span className="eyebrow">当前交易提示</span>
            <h1>{tradingStatus()}</h1>
            <p>
              {strongest
                ? `最近识别方向：${strongest.name}；龙头：${strongest.leaders[0]?.name ?? "等待确认"}。${strongest.phase === "加速" ? "当前已进入加速，避免情绪化追高。" : "优先观察资金承接和龙头是否继续扩散。"}`
                : "等待有效行情后再生成主线和龙头判断。"}
            </p>
          </div>
          <div className="focus-chip">
            <small>监测方向</small>
            <b>{strongest?.name ?? "等待行情"}</b>
            <span>机会分 <strong>{strongest?.overall ?? "—"}</strong></span>
            <span>阶段 <strong>{strongest?.phase ?? "—"}</strong></span>
          </div>
        </div>

        <div className="review-bar">
          <div><span>DAILY REVIEW</span><b>每日判断记录</b></div>
          <p>记录当天主线、阶段和龙头，下一交易日可直接核对判断是否正确。</p>
          <span className="review-date">{data?.sessionDate ?? "等待记录"} · 当前快照</span>
        </div>

        <section className="conclusion-card">
          <div className="conclusion-main">
            <span className="eyebrow">市场结论</span>
            <h2>{marketSummary}</h2>
            <p>
              <b>{strongest?.name ?? "暂无方向"}</b>{strongest ? `领先，${launchTheme?.name ?? "其他板块"}进入${launchTheme?.phase ?? "观察"}窗口` : "等待数据连接"}。
            </p>
            <small>只跟踪资金、强度、扩散度和龙头梯队共同确认的方向。</small>
          </div>
          <div className="temperature">
            <div className="temperature-ring" style={{ "--temperature": `${temperature * 3.6}deg` } as React.CSSProperties}>
              <span><b>{temperature}</b><small>/ 100</small></span>
            </div>
            <div className="temperature-copy">
              <span>主线温度</span>
              <p><b>{attackCount}</b> 个进攻方向 · <b>{phaseCounts.观察}</b> 个观察方向 · <b>{phaseCounts.退潮}</b> 个退潮方向</p>
            </div>
          </div>
          <div className="next-key">
            <span className="eyebrow">下一交易日关键</span>
            <b>{launchTheme?.name ?? strongest?.name ?? "等待新方向"}</b>
            <p>能否连续获得资金承接，且龙头不能明显掉队。</p>
          </div>
        </section>

        <section className="signal-grid" aria-label="主线信号">
          {[
            ["最强主线", strongest, "strong"],
            ["新启动", launchTheme, "launch"],
            ["第二候选", second, "candidate"],
            ["风险方向", riskTheme, "risk"],
          ].map(([label, themeValue, tone]) => {
            const theme = themeValue as RankedTheme | undefined;
            return (
              <article className={`signal-card ${tone}`} key={String(label)}>
                <span>{String(label)}</span>
                <h3>{theme?.name ?? "暂无"}</h3>
                <div><b>{theme?.overall ?? "—"}</b><small>评分</small></div>
                <p>{theme ? `${theme.phase} · ${money(theme.netIn)} · 龙一 ${theme.leaders[0]?.name ?? "待确认"}` : "等待有效行情"}</p>
              </article>
            );
          })}
        </section>

        <section className="leader-radar">
          <div className="section-heading">
            <div><span>EARLY LEADER RADAR</span><h2>潜在龙头雷达</h2></div>
            <p>优先找刚流入、刚扩散、尚未过度加速的方向。</p>
          </div>
          <div className="leader-cards">
            {earlyLeaders.map((theme) => (
              <article key={theme.id}>
                <div className="leader-card-top">
                  <span className={`phase-pill ${phaseClass[theme.phase]}`}>{theme.phase}</span>
                  <b>{theme.overall}</b>
                </div>
                <h3>{theme.leaders[0]?.name ?? "待确认"}</h3>
                <p>{theme.name} · 评分 {theme.overall}</p>
                <dl>
                  <div><dt>资金</dt><dd>{money(theme.netIn)}</dd></div>
                  <div><dt>扩散</dt><dd>{integer.format(theme.breadth * 100)}%</dd></div>
                  <div><dt>板块涨幅</dt><dd>{signed(theme.returns.day)}</dd></div>
                </dl>
                <strong>{theme.phase === "加速" ? "风险：不建议盲目追高" : "动作：加入观察，等待承接"}</strong>
              </article>
            ))}
          </div>
        </section>

        <div className="quick-links">
          <a href="#capital"><span>资金追踪</span><b>查看板块净流入与资金动作</b><em>打开 →</em></a>
          <a href="#watchlist"><span>个股观察</span><b>查看关注股票的主线身份</b><em>打开 →</em></a>
        </div>

        <section className="ranking-section">
          <div className="section-heading">
            <div><span>SECTOR PULSE</span><h2>板块强度排行</h2></div>
            <div className="ranking-controls">
              <label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索板块或龙头" /></label>
              <div className="sort-tabs">
                <button className={sortBy === "score" ? "active" : ""} onClick={() => setSortBy("score")}>按评分</button>
                <button className={sortBy === "money" ? "active" : ""} onClick={() => setSortBy("money")}>按资金</button>
                <button className={sortBy === "gain" ? "active" : ""} onClick={() => setSortBy("gain")}>按涨幅</button>
              </div>
            </div>
          </div>
          <div className="phase-tabs">
            {(["全部", "启动", "加速", "观察", "退潮"] as const).map((phase) => (
              <button key={phase} className={phaseFilter === phase ? "active" : ""} onClick={() => setPhaseFilter(phase)}>
                {phase}{phase !== "全部" ? ` ${phaseCounts[phase]}` : ""}
              </button>
            ))}
          </div>
          <div className="ranking-table">
            <div className="ranking-head">
              <span>排名 / 板块</span><span>阶段</span><span>强度</span><span>当日</span><span>主力净流入</span><span>趋势</span>
            </div>
            {visibleThemes.map((theme, index) => (
              <details className="ranking-row" key={theme.id}>
                <summary>
                  <span className="rank-name"><em>{String(index + 1).padStart(2, "0")}</em><b>{theme.name}</b><small>{theme.matchedBoard} · {theme.leaders[0]?.name ?? "龙头待确认"}</small></span>
                  <span><i className={`phase-pill ${phaseClass[theme.phase]}`}>{theme.phase}</i></span>
                  <span className="score-cell">{theme.overall}</span>
                  <span className={theme.returns.day >= 0 ? "positive" : "negative"}>{signed(theme.returns.day)}</span>
                  <span className={theme.netIn >= 0 ? "positive" : "negative"}>{money(theme.netIn)}</span>
                  <span className="trend-cell"><i style={{ width: `${clamp(theme.overall)}%` }} /></span>
                </summary>
                <div className="row-detail">
                  <div><span>龙一</span><b>{theme.leaders[0]?.name ?? "待确认"}</b></div>
                  <div><span>龙二</span><b>{theme.leaders[1]?.name ?? "待确认"}</b></div>
                  <div><span>近5日</span><b>{signed(theme.returns.fiveDay)}</b></div>
                  <div><span>近20日</span><b>{signed(theme.returns.twentyDay)}</b></div>
                  <p><b>观察依据：</b>{theme.catalyst}</p>
                  <p><b>失效条件：</b>{theme.risk}</p>
                </div>
              </details>
            ))}
            {!visibleThemes.length && <div className="no-result">没有符合当前条件的板块</div>}
          </div>
        </section>

        <section className="capital-section" id="capital">
          <div className="section-heading">
            <div><span>CAPITAL FLOW</span><h2>资金追踪</h2></div>
            <p>资金流入必须与涨幅、扩散和龙头承接一起看。</p>
          </div>
          <div className="capital-grid">
            <div className="flow-list">
              {[...ranked].sort((a, b) => b.netIn - a.netIn).slice(0, 6).map((theme) => (
                <div key={theme.id}>
                  <span><b>{theme.name}</b><small>{theme.phase}</small></span>
                  <i><em style={{ width: `${Math.max(4, Math.abs(theme.netIn) / maxFlow * 100)}%` }} /></i>
                  <strong className={theme.netIn >= 0 ? "positive" : "negative"}>{money(theme.netIn)}</strong>
                </div>
              ))}
            </div>
            <article className="capital-insight">
              <span className="eyebrow">资金动作解读</span>
              <h3>{[...ranked].sort((a, b) => b.netIn - a.netIn)[0]?.name ?? "等待行情"}</h3>
              <p>当前净流入靠前。若下一次刷新仍保持流入、上涨家数继续扩大，可从观察升级为启动；如果龙头掉队，则不确认主线。</p>
              <dl>
                <div><dt>流入第一</dt><dd>{money([...ranked].sort((a, b) => b.netIn - a.netIn)[0]?.netIn ?? 0)}</dd></div>
                <div><dt>流出第一</dt><dd>{money([...ranked].sort((a, b) => a.netIn - b.netIn)[0]?.netIn ?? 0)}</dd></div>
              </dl>
            </article>
          </div>
        </section>

        <section className="watchlist-section" id="watchlist">
          <div className="section-heading">
            <div><span>STOCK WATCH</span><h2>个股观察</h2></div>
            <p>先确认股票所在板块，再判断它是不是龙头。</p>
          </div>
          <div className="watch-grid">
            {watchStocks.map((stock) => {
              const theme = ranked.find((item) => item.leaders.some((leader) => leader.name === stock));
              const rank = theme?.leaders.findIndex((leader) => leader.name === stock) ?? -1;
              return (
                <article key={stock}>
                  <div><span className={`phase-pill ${theme ? phaseClass[theme.phase] : "watch"}`}>{theme?.phase ?? "观察"}</span><small>{theme ? `${rank === 0 ? "龙一" : "龙二"}候选` : "未进入前列"}</small></div>
                  <h3>{stock}</h3>
                  <p>{theme ? `${theme.name} · 综合评分 ${theme.overall}` : "当前未出现在主线板块龙一、龙二名单中。"}</p>
                  <dl>
                    <div><dt>所属方向</dt><dd>{theme?.name ?? "等待识别"}</dd></div>
                    <div><dt>阶段</dt><dd>{theme?.phase ?? "观察"}</dd></div>
                    <div><dt>提醒</dt><dd>{theme?.phase === "加速" ? "避免追高" : "等待确认"}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        </section>
      </section>

      <section className="method-strip">
        <div><span>01</span><b>资金流入</b></div>
        <div><span>02</span><b>上涨扩散</b></div>
        <div><span>03</span><b>持续强度</b></div>
        <div><span>04</span><b>龙头梯队</b></div>
        <p>{data?.method}</p>
      </section>

      <footer>
        <div><b>主线雷达</b><small>数据不足时，宁可不判断。</small></div>
        <p>公开行情可能延迟或中断，仅供市场研究，不构成投资建议。</p>
        <a href="#top">回到顶部 ↑</a>
      </footer>
    </main>
  );
}
