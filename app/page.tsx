"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = {
  id: string;
  name: string;
  stage: string;
  status: "confirmed" | "candidate" | "rotation" | "watch";
  score: number;
  confidence: string;
  duration: string;
  catalyst: string;
  invalidation: string;
  components: Record<string, number>;
  leadRank: { rank: string; name: string; role: string }[];
  leaders: { capacity: string[]; trend: string[]; emotion: string[] };
  live: null | { board?: string; change: number; netIn: number; breadth: number | null };
};

type Payload = {
  live: boolean;
  sourceLabel: string;
  asOf: string;
  researchAsOf: string;
  regime: string;
  themes: Theme[];
  rotation: { period: string; title: string; note: string }[];
};

const labels: Record<string, string> = {
  confirmed: "中期主线",
  candidate: "主线候选",
  rotation: "阶段轮动",
  watch: "题材观察",
};

const componentLabels: Record<string, string> = {
  continuity: "持续性",
  capacity: "容量",
  breadth: "扩散",
  capital: "资金",
  catalyst: "催化",
  resilience: "抗分歧",
};

const format = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

export default function Home() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState("ai-hardware");
  const [watchlist, setWatchlist] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      if (!response.ok) throw new Error("数据暂不可用");
      setData(await response.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const saved = localStorage.getItem("mainline-watchlist-v2");
    if (saved) setWatchlist(JSON.parse(saved));
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const themes = useMemo(
    () => data?.themes.filter((theme) => filter === "all" || theme.status === filter) ?? [],
    [data, filter],
  );
  const active = data?.themes.find((theme) => theme.id === selected) ?? data?.themes[0];

  function toggleWatch(id: string) {
    const next = watchlist.includes(id) ? watchlist.filter((item) => item !== id) : [...watchlist, id];
    setWatchlist(next);
    localStorage.setItem("mainline-watchlist-v2", JSON.stringify(next));
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="返回顶部">
          <span className="brand-mark">M</span>
          <span><strong>主线雷达</strong><small>MAINLINE RADAR</small></span>
        </a>
        <nav>
          <a href="#radar">当前雷达</a>
          <a href="#rotation">2026路线图</a>
          <a href="#positions">个股定位</a>
        </nav>
        <div className="market-clock">
          <span className={`pulse ${data?.live ? "live" : ""}`} />
          <span><strong>{data?.live ? "公开行情已连接" : "研究快照"}</strong><small>{data?.asOf ?? "载入中"}</small></span>
          <button onClick={load} disabled={loading}>{loading ? "更新中" : "更新"}</button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-main">
          <span className="eyebrow">2026 MARKET REGIME / 截至 {data?.researchAsOf ?? "—"}</span>
          <h1>识别主线，<br /><em>不追逐噪声。</em></h1>
          <p>{data?.regime ?? "正在识别市场结构…"}</p>
          <div className="hero-actions">
            <a href="#radar">查看主线排名</a>
            <span>模型结论 ≠ 单日涨幅排名</span>
          </div>
        </div>
        <div className="thesis-card">
          <span>当前总判断</span>
          <strong>一条主轴<br />三组候选</strong>
          <p>主轴：AI硬件与国产替代<br />候选：半导体回流、军工、电网<br />试错：VC涨价等小容量题材</p>
          <i>01</i>
        </div>
        <div className="method-card">
          <span className="eyebrow">MODEL 2.0</span>
          <h2>当天温度与<br />中期趋势分开算</h2>
          <div><b>行情层</b><p>涨幅 · 净流入 · 上涨家数</p></div>
          <div><b>研究层</b><p>持续性 · 容量 · 梯队 · 产业兑现</p></div>
        </div>
      </section>

      <section className="signal-strip">
        <div><b>84</b><span>AI硬件<br />中期主线</span></div>
        <div><b>78</b><span>半导体<br />回流候选</span></div>
        <div><b>69</b><span>军工<br />新主线候选</span></div>
        <p><i /> 两日强势只能进入候选池，分歧承接与容量股跟随决定能否升级。</p>
      </section>

      <section className="dashboard" id="radar">
        <div className="section-heading">
          <div><span className="eyebrow">MAINLINE RANKING</span><h2>当前市场结构</h2></div>
          <div className="filters" aria-label="筛选市场结构">
            {[
              ["all", "全部"],
              ["confirmed", "中期主线"],
              ["candidate", "候选"],
              ["rotation", "轮动"],
              ["watch", "观察"],
            ].map(([key, text]) => (
              <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{text}</button>
            ))}
          </div>
        </div>

        <div className="radar-grid">
          <div className="theme-list">
            <div className="list-head"><span>方向 / 定位</span><span>当天温度</span><span>模型分</span></div>
            {themes.map((theme, index) => (
              <button
                key={theme.id}
                className={`theme-row ${selected === theme.id ? "selected" : ""}`}
                onClick={() => setSelected(theme.id)}
              >
                <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="theme-name">
                  <strong>{theme.name}</strong>
                  <small><i className={theme.status} />{labels[theme.status]} · {theme.duration}</small>
                  <span className="quick-leaders">
                    <b>龙一 {theme.leadRank[0].name}</b>
                    <b>龙二 {theme.leadRank[1].name}</b>
                  </span>
                </span>
                <span className={`live-change ${(theme.live?.change ?? 0) < 0 ? "down" : ""}`}>
                  {theme.live ? `${theme.live.change >= 0 ? "+" : ""}${format.format(theme.live.change)}%` : "休市"}
                  <small>{theme.live?.board ?? "研究快照"}</small>
                </span>
                <span className="theme-score"><b>{theme.score}</b><small>{theme.confidence}置信</small></span>
                <span
                  role="checkbox"
                  aria-checked={watchlist.includes(theme.id)}
                  className={`watch ${watchlist.includes(theme.id) ? "active" : ""}`}
                  onClick={(event) => { event.stopPropagation(); toggleWatch(theme.id); }}
                >{watchlist.includes(theme.id) ? "★" : "☆"}</span>
              </button>
            ))}
          </div>

          {active && (
            <aside className="detail-card">
              <div className="detail-title">
                <div><span className={`pill ${active.status}`}>{labels[active.status]}</span><h2>{active.name}</h2><p>{active.stage} · {active.confidence}置信度</p></div>
                <div className="score-disc"><b>{active.score}</b><small>/ 100</small></div>
              </div>
              <div className="factor-grid">
                {Object.entries(active.components).map(([key, value]) => (
                  <div key={key}><span>{componentLabels[key]}</span><b>{value}</b><i><em style={{ width: `${value * 5}%` }} /></i></div>
                ))}
              </div>
              <div className="dragon-rank">
                {active.leadRank.map((leader) => (
                  <div key={leader.rank}>
                    <span>{leader.rank}</span>
                    <p><b>{leader.name}</b><small>{leader.role}</small></p>
                  </div>
                ))}
              </div>
              <div className="leader-stack">
                <span>辅助梯队</span>
                <p><b>容量中军</b>{active.leaders.capacity.join(" · ")}</p>
                <p><b>趋势核心</b>{active.leaders.trend.join(" · ")}</p>
                <p><b>情绪先锋</b>{active.leaders.emotion.join(" · ")}</p>
              </div>
              <div className="catalyst"><span>核心催化</span><p>{active.catalyst}</p></div>
              <div className="invalidate"><span>降级条件</span><p>{active.invalidation}</p></div>
            </aside>
          )}
        </div>
      </section>

      <section className="rotation-section" id="rotation">
        <div className="section-heading inverse">
          <div><span className="eyebrow">ROTATION MAP</span><h2>2026主线迁移路线</h2></div>
          <p>主线不是每天重置，而是在预期、资金和业绩之间迁移。</p>
        </div>
        <div className="rotation-line">
          {data?.rotation.map((item, index) => (
            <article key={item.period}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <small>{item.period}</small>
              <h3>{item.title}</h3>
              <p>{item.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="positions" id="positions">
        <div className="section-heading">
          <div><span className="eyebrow">FOCUS POSITIONING</span><h2>个股放回板块里看</h2></div>
          <p>龙头身份不同，观察指标也不同。</p>
        </div>
        <div className="position-grid">
          <article>
            <div><span className="number">01</span><span className="pill candidate">军工情绪核心</span></div>
            <h3>长城军工</h3>
            <p>它能证明军工短线强，却不能单独证明军工成为市场总主线。</p>
            <dl><dt>升级观察</dt><dd>分歧承接、容量股跟随、军工电子与整机扩散</dd><dt>关键风险</dt><dd>高位抱团瓦解且建设工业、中光学等同步退潮</dd></dl>
          </article>
          <article>
            <div><span className="number">02</span><span className="pill watch">VC题材先锋</span></div>
            <h3>孚日股份</h3>
            <p>传统属性是家纺，当前交易标签是VC添加剂涨价预期。</p>
            <dl><dt>升级观察</dt><dd>报价被订单验证，华盛锂电、日科化学形成梯队</dd><dt>关键风险</dt><dd>容量过小，断板后板块没有中军承接</dd></dl>
          </article>
          <article className="rules-card">
            <span className="eyebrow">UPGRADE RULES</span>
            <h3>热点升级为主线<br />至少满足 4 / 6</h3>
            <ul>
              <li>持续两周以上并多次回流</li>
              <li>具备千亿级或高成交容量核心</li>
              <li>先锋、中军、补涨梯队完整</li>
              <li>弱市抗跌，强市主动领涨</li>
              <li>催化可被订单或业绩验证</li>
              <li>分歧日缩量承接而非集体退潮</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="data-note">
        <div><span className={`pulse ${data?.live ? "live" : ""}`} /><p><b>{data?.sourceLabel ?? "数据载入中"}</b><small>行情用于当日温度；研究结论截至 {data?.researchAsOf ?? "—"}，休市时不把快照伪装成实时。</small></p></div>
        <p>公开接口可能延迟或中断。正式交易系统应接入持牌数据服务商，本工具仅供研究，不构成投资建议。</p>
      </section>

      <footer><strong>主线雷达</strong><span>资金行为有迹可循，市场结果不可保证。</span><a href="#top">回到顶部 ↑</a></footer>
    </main>
  );
}
