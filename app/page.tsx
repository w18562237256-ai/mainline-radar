"use client";

import { useEffect, useMemo, useState } from "react";

type Board = {
  code: string;
  name: string;
  score: number;
  change: number;
  netIn: number;
  breadth: number;
  up: number;
  down: number;
  persistence: number;
  leaders: string[];
  tag: string;
};

type MarketPayload = {
  source: "eastmoney" | "snapshot";
  sourceLabel: string;
  asOf: string;
  marketState: string;
  boards: Board[];
};

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function scoreTone(score: number) {
  if (score >= 80) return "confirmed";
  if (score >= 68) return "candidate";
  if (score >= 55) return "watch";
  return "cool";
}

function scoreLabel(score: number) {
  if (score >= 80) return "主线确认";
  if (score >= 68) return "主线候选";
  if (score >= 55) return "轮动观察";
  return "强度不足";
}

export default function Home() {
  const [payload, setPayload] = useState<MarketPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "change" | "netIn" | "breadth">("score");
  const [query, setQuery] = useState("");
  const [watching, setWatching] = useState<string[]>([]);

  async function loadMarket() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      if (!response.ok) throw new Error("数据服务暂时不可用");
      setPayload(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMarket();
    const saved = window.localStorage.getItem("mainline-watchlist");
    if (saved) setWatching(JSON.parse(saved));
    const timer = window.setInterval(loadMarket, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const boards = useMemo(() => {
    if (!payload) return [];
    return [...payload.boards]
      .filter((board) => board.name.includes(query.trim()))
      .sort((a, b) => b[sortBy] - a[sortBy]);
  }, [payload, query, sortBy]);

  const top = payload?.boards[0];
  const confirmed = payload?.boards.filter((board) => board.score >= 80).length ?? 0;
  const candidates = payload?.boards.filter((board) => board.score >= 68 && board.score < 80).length ?? 0;

  function toggleWatch(code: string) {
    const next = watching.includes(code)
      ? watching.filter((item) => item !== code)
      : [...watching, code];
    setWatching(next);
    window.localStorage.setItem("mainline-watchlist", JSON.stringify(next));
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <strong>主线雷达</strong>
            <small>MAINLINE RADAR · A股资金监测</small>
          </div>
        </div>
        <div className="market-clock">
          <span className={`pulse ${payload?.source === "eastmoney" ? "live" : ""}`} />
          <div>
            <strong>{payload?.source === "eastmoney" ? "行情已连接" : "使用最近快照"}</strong>
            <small>{payload ? payload.asOf : "正在连接数据…"}</small>
          </div>
          <button className="refresh" onClick={loadMarket} disabled={loading} aria-label="刷新市场数据">
            {loading ? "刷新中" : "刷新"}
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">市场状态 / {payload?.marketState ?? "识别中"}</div>
          <h1>
            当前主线候选
            <span>{top?.name ?? "—"}</span>
          </h1>
          <p>
            综合资金强度、板块扩散、走势持续与龙头梯队。单日上涨不会直接判定为主线，
            分歧后的承接才会提高确认度。
          </p>
          <div className="hero-actions">
            <a href="#ranking">查看完整排名</a>
            <button onClick={() => top && toggleWatch(top.code)}>
              {top && watching.includes(top.code) ? "已加入观察" : "加入观察"}
            </button>
          </div>
        </div>

        <div className="score-card">
          <div className="score-ring" style={{ "--score": top?.score ?? 0 } as React.CSSProperties}>
            <div>
              <b>{top?.score ?? "--"}</b>
              <small>主线确认度</small>
            </div>
          </div>
          <span className={`status ${scoreTone(top?.score ?? 0)}`}>{scoreLabel(top?.score ?? 0)}</span>
        </div>

        <div className="hero-metrics">
          <div>
            <small>当日涨幅</small>
            <strong className="red">+{number.format(top?.change ?? 0)}%</strong>
            <span>动量强度</span>
          </div>
          <div>
            <small>主力净流入</small>
            <strong>{number.format(top?.netIn ?? 0)}亿</strong>
            <span>资金强度</span>
          </div>
          <div>
            <small>上涨占比</small>
            <strong>{number.format((top?.breadth ?? 0) * 100)}%</strong>
            <span>{top?.up ?? 0}涨 / {top?.down ?? 0}跌</span>
          </div>
          <div>
            <small>持续天数</small>
            <strong>{top?.persistence ?? 0}天</strong>
            <span>连续活跃</span>
          </div>
        </div>
      </section>

      <section className="summary-strip">
        <div><b>{confirmed}</b><span>已确认主线</span></div>
        <div><b>{candidates}</b><span>主线候选</span></div>
        <div><b>{payload?.boards.length ?? 0}</b><span>跟踪板块</span></div>
        <p>
          <span className="dot" /> 风险提示：当龙头跌破关键承接位、板块上涨占比低于45%，系统会自动降级。
        </p>
      </section>

      <section className="workspace" id="ranking">
        <div className="ranking-panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">SECTOR RANKING</span>
              <h2>市场主线强度榜</h2>
            </div>
            <div className="tools">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索板块"
                aria-label="搜索板块"
              />
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
                <option value="score">按确认度</option>
                <option value="change">按涨幅</option>
                <option value="netIn">按资金</option>
                <option value="breadth">按扩散</option>
              </select>
            </div>
          </div>

          <div className="board-list">
            {boards.map((board, index) => (
              <article className="board-row" key={board.code}>
                <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                <div className="board-name">
                  <div>
                    <h3>{board.name}</h3>
                    <span>{board.tag}</span>
                  </div>
                  <small>龙头：{board.leaders.join(" · ")}</small>
                </div>
                <div className="mini-stat">
                  <small>涨幅</small>
                  <b className={board.change >= 0 ? "red" : "green"}>
                    {board.change >= 0 ? "+" : ""}{number.format(board.change)}%
                  </b>
                </div>
                <div className="mini-stat">
                  <small>净流入</small>
                  <b>{number.format(board.netIn)}亿</b>
                </div>
                <div className="breadth">
                  <div><small>扩散度</small><b>{number.format(board.breadth * 100)}%</b></div>
                  <i><span style={{ width: `${board.breadth * 100}%` }} /></i>
                </div>
                <div className="row-score">
                  <b>{board.score}</b>
                  <span className={`status ${scoreTone(board.score)}`}>{scoreLabel(board.score)}</span>
                </div>
                <button
                  className={`star ${watching.includes(board.code) ? "active" : ""}`}
                  onClick={() => toggleWatch(board.code)}
                  aria-label={`${watching.includes(board.code) ? "取消" : "加入"}观察 ${board.name}`}
                >
                  {watching.includes(board.code) ? "★" : "☆"}
                </button>
              </article>
            ))}
            {!loading && boards.length === 0 && <div className="empty">没有找到对应板块</div>}
          </div>
          {error && <div className="error">{error}，请稍后刷新。</div>}
        </div>

        <aside>
          <section className="side-card checklist">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">CONFIRMATION</span>
                <h2>主线确认清单</h2>
              </div>
              <strong>4 / 5</strong>
            </div>
            {[
              ["资金连续回流", "连续两日净流入", true],
              ["板块有效扩散", "上涨占比超过60%", true],
              ["龙头梯队完整", "2板＋首板助攻", true],
              ["逆势强度突出", "弱市中保持红盘", true],
              ["分歧日完成验证", "等待首次换手承接", false],
            ].map(([title, detail, done]) => (
              <div className="check-item" key={String(title)}>
                <span className={done ? "done" : ""}>{done ? "✓" : "·"}</span>
                <div><b>{title}</b><small>{detail}</small></div>
              </div>
            ))}
          </section>

          <section className="side-card focus">
            <span className="eyebrow">FOCUS STOCK</span>
            <div className="focus-title">
              <div><h2>长城军工</h2><small>601606 · 兵装重组</small></div>
              <b>32.05</b>
            </div>
            <div className="focus-grid">
              <div><small>短线结构</small><b>2连板</b></div>
              <div><small>龙虎榜净买</small><b>1.60亿</b></div>
              <div><small>关键承接</small><b>30.03</b></div>
              <div><small>结构失效</small><b>29.14</b></div>
            </div>
            <p>观察首次大分歧时的成交与回封。融资快速增加并叠加放量炸板，将触发风险预警。</p>
          </section>

          <section className="side-card source-card">
            <div>
              <span className={`pulse ${payload?.source === "eastmoney" ? "live" : ""}`} />
              <div><b>{payload?.sourceLabel ?? "连接数据源"}</b><small>60秒自动刷新</small></div>
            </div>
            <p>行情来自公开接口，仅用于研究展示；正式交易系统建议接入持牌数据商授权接口。</p>
          </section>
        </aside>
      </section>

      <footer>
        <span>主线雷达 · 让资金行为有迹可循</span>
        <p>评分是辅助观察工具，不构成证券投资建议。市场有风险，决策需独立。</p>
      </footer>
    </main>
  );
}
