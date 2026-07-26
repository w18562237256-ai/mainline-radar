"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = {
  id: string;
  name: string;
  status: "confirmed" | "candidate" | "rotation" | "watch";
  score: number;
  duration: string;
  catalyst: string;
  invalidation: string;
  leadRank: { rank: string; name: string; role: string }[];
  leaders: { capacity: string[]; trend: string[]; emotion: string[] };
  live: null | { board?: string; change: number; netIn: number; breadth: number | null };
};

type Payload = {
  live: boolean;
  sourceLabel: string;
  asOf: string;
  researchAsOf: string;
  themes: Theme[];
  rotation: { period: string; title: string; note: string }[];
};

const plainText: Record<string, { state: string; action: string; summary: string; tomorrow: string }> = {
  "ai-hardware": {
    state: "主线还在",
    action: "别追高",
    summary: "上半年最强方向，但位置已经不低，适合等回调确认。",
    tomorrow: "中际旭创、新易盛能否止跌回升",
  },
  semiconductor: {
    state: "可能接班",
    action: "等回流",
    summary: "大资金开始回到设备和存储，正在争夺下一段主线。",
    tomorrow: "北方华创、中微公司是否继续放量",
  },
  military: {
    state: "短线最强",
    action: "看分歧",
    summary: "当前辨识度高，但仍需容量股跟涨，才能升级成真正主线。",
    tomorrow: "长城军工分歧后能否承接",
  },
  "power-grid": {
    state: "轮动热点",
    action: "不追涨",
    summary: "有招标催化，但持续时间还短，暂时按轮动看。",
    tomorrow: "中国西电能否带板块再次走强",
  },
  "commercial-space": {
    state: "老主线反弹",
    action: "看中军",
    summary: "1月曾经很强，现在需要中国卫星等大票重新表态。",
    tomorrow: "反弹是否从小票扩散到容量股",
  },
  "innovative-drug": {
    state: "高低切换",
    action: "只低吸",
    summary: "主要是资金从高位科技撤出后的低位轮动。",
    tomorrow: "核心股能否连续强于指数",
  },
  "vc-additive": {
    state: "小题材试错",
    action: "高风险",
    summary: "孚日股份很强，但板块太小，目前不能叫市场主线。",
    tomorrow: "日科化学、华盛锂电是否跟上",
  },
};

const stateClass: Record<string, string> = {
  confirmed: "go",
  candidate: "wait",
  rotation: "turn",
  watch: "risk",
};

export default function Home() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      if (response.ok) setData(await response.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const themes = useMemo(
    () => data?.themes.filter((theme) => filter === "all" || theme.status === filter) ?? [],
    [data, filter],
  );

  const findTheme = (id: string) => data?.themes.find((theme) => theme.id === id);

  return (
    <main>
      <header className="topbar" id="top">
        <a className="brand" href="#top"><span>主</span><b>主线雷达</b></a>
        <nav><a href="#today">今天看什么</a><a href="#list">板块排名</a><a href="#stocks">重点个股</a></nav>
        <div className="clock">
          <i className={data?.live ? "live" : ""} />
          <span><b>{data?.live ? "行情已连接" : "收盘数据"}</b><small>{data?.asOf ?? "载入中"}</small></span>
          <button onClick={load} disabled={loading}>{loading ? "更新中" : "更新"}</button>
        </div>
      </header>

      <section className="hero" id="today">
        <div>
          <span className="date">判断截至 {data?.researchAsOf ?? "—"}</span>
          <h1>今天的市场，<br />先看这三件事。</h1>
          <p>不用先看复杂分数。先看谁是主线、谁可能接班、谁只是短炒。</p>
        </div>
        <div className="today-cards">
          <article className="main-card">
            <span>① 现在的主线</span>
            <h2>AI硬件</h2>
            <strong>主线还在，但别追高</strong>
            <p>中际旭创 · 新易盛</p>
          </article>
          <article>
            <span>② 最强候选</span>
            <h2>军工</h2>
            <strong>看长城军工分歧承接</strong>
            <p>龙一 长城军工 · 龙二 建设工业</p>
          </article>
          <article>
            <span>③ 高风险试错</span>
            <h2>VC添加剂</h2>
            <strong>个股强，不等于板块是主线</strong>
            <p>龙一 孚日股份 · 龙二 日科化学</p>
          </article>
        </div>
      </section>

      <section className="simple-note">
        <b>一句话结论</b>
        <p>AI硬件是老主线，半导体和军工在争接班；电网、创新药、VC目前先按轮动看。</p>
      </section>

      <section className="board-section" id="list">
        <div className="section-title">
          <div><span>板块红绿灯</span><h2>现在炒什么，一眼看懂</h2></div>
          <div className="filters">
            {[["all", "全部"], ["confirmed", "主线"], ["candidate", "候选"], ["rotation", "轮动"], ["watch", "高风险"]].map(([key, label]) => (
              <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="board-list">
          <div className="board-head"><span>板块</span><span>现在是什么</span><span>龙一 / 龙二</span><span>我的提醒</span><span>明天看什么</span></div>
          {themes.map((theme) => {
            const copy = plainText[theme.id];
            return (
              <details className="board-row" key={theme.id}>
                <summary>
                  <span className="board-name"><b>{theme.name}</b><small>{copy.summary}</small></span>
                  <span className={`state ${stateClass[theme.status]}`}><i />{copy.state}</span>
                  <span className="dragons">
                    <b><em>龙一</em>{theme.leadRank[0].name}</b>
                    <b><em>龙二</em>{theme.leadRank[1].name}</b>
                  </span>
                  <span className={`action ${theme.status === "watch" ? "danger" : ""}`}>{copy.action}</span>
                  <span className="tomorrow">{copy.tomorrow}</span>
                  <span className="arrow">⌄</span>
                </summary>
                <div className="more">
                  <div><b>为什么会涨</b><p>{theme.catalyst}</p></div>
                  <div><b>什么情况说明看错了</b><p>{theme.invalidation}</p></div>
                  <div><b>其他重要股票</b><p>{[...theme.leaders.capacity, ...theme.leaders.trend, ...theme.leaders.emotion].filter((name, index, array) => array.indexOf(name) === index).join(" · ")}</p></div>
                  <div><b>当日行情</b><p>{theme.live ? `${theme.live.board} ${theme.live.change >= 0 ? "+" : ""}${theme.live.change.toFixed(1)}%` : "休市，显示最近收盘判断"}</p></div>
                </div>
              </details>
            );
          })}
        </div>
        <p className="rank-note">龙一、龙二代表当前阶段辨识度排序，不代表公司质量排名，也会随每天的分歧承接发生变化。</p>
      </section>

      <section className="history">
        <div className="section-title light"><div><span>2026年轮动</span><h2>今年的资金走到哪了？</h2></div></div>
        <div className="history-line">
          {data?.rotation.map((item, index) => (
            <article key={item.period}><b>{index + 1}</b><span>{item.period}</span><h3>{item.title}</h3><p>{item.note}</p></article>
          ))}
        </div>
      </section>

      <section className="stock-section" id="stocks">
        <div className="section-title"><div><span>你关心的股票</span><h2>到底该怎么理解？</h2></div></div>
        <div className="stock-grid">
          <article>
            <span className="stock-tag wait">军工龙一 · 情绪先锋</span>
            <h2>长城军工</h2>
            <p className="plain-answer">它是军工短线最强股，但军工能不能成为大主线，还要看大市值军工股是否一起上涨。</p>
            <div><b>明天重点看</b><p>{plainText.military.tomorrow}</p></div>
            <div><b>看到这个要小心</b><p>长城军工走弱，同时建设工业、中光学也退潮。</p></div>
          </article>
          <article>
            <span className="stock-tag risk">VC龙一 · 高风险先锋</span>
            <h2>孚日股份</h2>
            <p className="plain-answer">现在炒的是VC涨价，不是家纺。它可以是题材龙一，但题材太小，暂时不能叫市场主线。</p>
            <div><b>明天重点看</b><p>{plainText["vc-additive"].tomorrow}</p></div>
            <div><b>看到这个要小心</b><p>孚日股份断板后，没有其他VC股票接力。</p></div>
          </article>
        </div>
      </section>

      <section className="how">
        <h2>网站以后只回答四个问题</h2>
        <div><span>1</span><b>现在炒什么？</b></div>
        <div><span>2</span><b>龙一龙二是谁？</b></div>
        <div><span>3</span><b>还能不能追？</b></div>
        <div><span>4</span><b>明天看什么？</b></div>
      </section>

      <section className="data-note">
        <p><b>{data?.sourceLabel ?? "正在连接数据"}</b><small>公开行情负责当天涨跌，研究判断截至 {data?.researchAsOf ?? "—"}。休市时不会伪装成实时。</small></p>
        <p>仅供市场研究，不构成投资建议。</p>
      </section>
      <footer><b>主线雷达</b><span>把复杂市场，说得简单一点。</span><a href="#top">回到顶部 ↑</a></footer>
    </main>
  );
}
