"use client";

import { useEffect, useMemo, useState } from "react";

type PeriodLeader = { id: string; name: string; score: number; strength: string };
type Theme = {
  id: string;
  name: string;
  matchedBoard: string;
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
};

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function advice(score: number) {
  if (score >= 75) return "很强，别追高";
  if (score >= 62) return "重点观察";
  if (score >= 50) return "等待转强";
  return "暂不关注";
}

function themeRole(theme: Theme, leaders: Payload["leaders"]) {
  if (!leaders) return "未判断";
  const roles = [];
  if (leaders.mid.id === theme.id) roles.push("中期");
  if (leaders.current.id === theme.id) roles.push("近5日");
  if (leaders.day.id === theme.id) roles.push("今日");
  return roles.length ? `${roles.join("＋")}最强` : "跟踪板块";
}

function returnClass(value: number) {
  return value >= 0 ? "up" : "down";
}

export default function Home() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"current" | "day" | "mid">("current");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      setData(await response.json());
    } catch {
      setData({
        available: false, sourceLabel: "行情数据暂时未连接", sessionDate: null,
        updatedAt: null, leaders: null, themes: [],
        method: "数据源中断时暂停判断，不使用旧结论冒充实时结果。",
      });
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
    () => [...(data?.themes ?? [])].sort((a, b) => b.scores[sortBy] - a.scores[sortBy]),
    [data, sortBy],
  );

  const findTheme = (id?: string) => data?.themes.find((theme) => theme.id === id);

  return (
    <main>
      <header className="topbar" id="top">
        <a className="brand" href="#top"><span>主</span><b>主线雷达</b></a>
        <nav><a href="#today">三周期结论</a><a href="#list">板块排名</a><a href="#method">怎么算的</a></nav>
        <div className="clock">
          <i className={data?.available ? "live" : ""} />
          <span>
            <b>{data?.sourceLabel ?? "正在连接"}</b>
            <small>{data?.sessionDate ? `交易日 ${data.sessionDate}` : "暂停判断"}</small>
          </span>
          <button onClick={load} disabled={loading}>{loading ? "更新中" : "更新"}</button>
        </div>
      </header>

      <section className="hero" id="today">
        <div>
          <span className="date">
            {data?.sessionDate ? `最近交易日 ${data.sessionDate}` : "等待有效行情"}
          </span>
          <h1>不再只说一个<br />“当前主线”。</h1>
          <p>今天强、最近强和中期强是三件不同的事。网站现在分开计算，不再把历史结论写死。</p>
        </div>

        {data?.available && data.leaders ? (
          <div className="today-cards dynamic">
            {[
              ["中期主线", "近20个交易日", data.leaders.mid],
              ["当前主线", "近5个交易日", data.leaders.current],
              ["今日主线", "最近交易日", data.leaders.day],
            ].map(([label, period, leader], index) => {
              const item = leader as PeriodLeader;
              const theme = findTheme(item.id);
              return (
                <article className={index === 1 ? "main-card" : ""} key={String(label)}>
                  <span>{label} · {period as string}</span>
                  <h2>{item.name}</h2>
                  <strong>{item.strength} · {item.score}分</strong>
                  <p>
                    龙一 {theme?.leaders[0]?.name ?? "待确认"} ·
                    龙二 {theme?.leaders[1]?.name ?? "待确认"}
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="offline-card">
            <span>暂不输出结论</span>
            <h2>行情数据没有连接成功</h2>
            <p>旧版会继续显示“AI硬件是主线”；新版会暂停判断，避免用旧数据误导你。</p>
            <button onClick={load}>重新连接</button>
          </div>
        )}
      </section>

      <section className={`simple-note ${data?.available ? "" : "offline"}`}>
        <b>{data?.available ? "系统结论" : "数据状态"}</b>
        <p>
          {data?.available && data.leaders
            ? `近20日最强是${data.leaders.mid.name}，近5日最强是${data.leaders.current.name}，最近交易日最强是${data.leaders.day.name}。`
            : "没有有效行情时不做主线排名，也不显示人工预设答案。"}
        </p>
      </section>

      <section className="board-section" id="list">
        <div className="section-title">
          <div><span>自动排名</span><h2>哪个周期最强，由数据决定</h2></div>
          <div className="filters">
            <button className={sortBy === "mid" ? "active" : ""} onClick={() => setSortBy("mid")}>近20日</button>
            <button className={sortBy === "current" ? "active" : ""} onClick={() => setSortBy("current")}>近5日</button>
            <button className={sortBy === "day" ? "active" : ""} onClick={() => setSortBy("day")}>今日</button>
          </div>
        </div>

        {data?.available ? (
          <>
            <div className="board-list">
              <div className="board-head dynamic-head">
                <span>板块</span><span>系统身份</span><span>龙一 / 龙二</span><span>今日</span><span>近5日</span><span>近20日</span><span>提醒</span>
              </div>
              {themes.map((theme) => (
                <details className="board-row" key={theme.id}>
                  <summary className="dynamic-row">
                    <span className="board-name"><b>{theme.name}</b><small>对应行情：{theme.matchedBoard}</small></span>
                    <span className="state wait"><i />{themeRole(theme, data.leaders)}</span>
                    <span className="dragons">
                      <b><em>龙一</em>{theme.leaders[0]?.name ?? "待确认"}</b>
                      <b><em>龙二</em>{theme.leaders[1]?.name ?? "待确认"}</b>
                    </span>
                    <span className={returnClass(theme.returns.day)}>{theme.returns.day >= 0 ? "+" : ""}{number.format(theme.returns.day)}%</span>
                    <span className={returnClass(theme.returns.fiveDay)}>{theme.returns.fiveDay >= 0 ? "+" : ""}{number.format(theme.returns.fiveDay)}%</span>
                    <span className={returnClass(theme.returns.twentyDay)}>{theme.returns.twentyDay >= 0 ? "+" : ""}{number.format(theme.returns.twentyDay)}%</span>
                    <span className="action">{advice(theme.scores[sortBy])}</span>
                    <span className="arrow">⌄</span>
                  </summary>
                  <div className="more">
                    <div><b>为什么会涨</b><p>{theme.catalyst}</p></div>
                    <div><b>资金和扩散</b><p>主力净流入 {number.format(theme.netIn)}亿元，上涨家数占比 {number.format(theme.breadth * 100)}%</p></div>
                    <div><b>什么情况说明看错了</b><p>{theme.risk}</p></div>
                    <div><b>模型分</b><p>今日 {theme.scores.day} · 近5日 {theme.scores.current} · 近20日 {theme.scores.mid}</p></div>
                  </div>
                </details>
              ))}
            </div>
            <p className="rank-note">龙一、龙二按板块内近5日强度、当日强度和成交容量综合排序；并非人工固定名单。</p>
          </>
        ) : (
          <div className="empty-state"><b>暂无排名</b><p>行情恢复后自动出现，不回退到旧快照。</p></div>
        )}
      </section>

      <section className="method-section" id="method">
        <div className="section-title light"><div><span>判断方法</span><h2>三个问题，三套数据</h2></div></div>
        <div className="method-grid">
          <article><b>01</b><h3>今日谁最强？</h3><p>看当天涨幅、上涨家数占比和资金强度。</p></article>
          <article><b>02</b><h3>最近谁持续？</h3><p>看近5日累计表现、上涨天数和今日承接。</p></article>
          <article><b>03</b><h3>中期谁领先？</h3><p>看近20日趋势，同时要求近期没有明显掉队。</p></article>
        </div>
        <p className="method-copy">{data?.method}</p>
      </section>

      <section className="stock-section">
        <div className="section-title"><div><span>你关心的股票</span><h2>身份也会跟着数据变化</h2></div></div>
        <div className="stock-grid">
          {[
            ["military", "长城军工", "军工"],
            ["vc-additive", "孚日股份", "VC添加剂"],
          ].map(([id, stock, sector]) => {
            const theme = findTheme(id);
            const rank = theme?.leaders.findIndex((leader) => leader.name === stock) ?? -1;
            return (
              <article key={id}>
                <span className={`stock-tag ${rank < 0 ? "risk" : "wait"}`}>
                  {theme ? (rank >= 0 ? `${sector}${rank === 0 ? "龙一" : "龙二"}` : "未进入动态前二") : "等待行情"}
                </span>
                <h2>{stock}</h2>
                <p className="plain-answer">
                  {theme
                    ? `所在板块近5日模型分为 ${theme.scores.current}。系统会随强度和成交容量重新排序，不再固定它的龙头身份。`
                    : "行情未连接，暂不判断它是不是龙头。"}
                </p>
                <div><b>板块风险</b><p>{theme?.risk ?? "等待有效行情后更新"}</p></div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="data-note">
        <p><b>{data?.sourceLabel ?? "正在连接数据"}</b><small>交易日来自板块K线最后一根记录；刷新时间 {data?.updatedAt ?? "—"}。</small></p>
        <p>公开接口可能延迟或中断，仅供市场研究，不构成投资建议。</p>
      </section>
      <footer><b>主线雷达</b><span>数据不足时，宁可不判断。</span><a href="#top">回到顶部 ↑</a></footer>
    </main>
  );
}
