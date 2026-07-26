import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Leader = {
  rank: "龙一" | "龙二";
  code: string;
  name: string;
  change: number;
  constituentVerified: true;
};

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

export async function GET(request: NextRequest) {
  const board = request.nextUrl.searchParams.get("board")?.toUpperCase() ?? "";
  if (!/^BK\d{4}$/.test(board)) {
    return NextResponse.json({ available: false, leaders: [] }, { status: 400 });
  }

  try {
    const response = await fetch(`https://www.lwwhy.com/trading/sector/${board}`, {
      headers: { "User-Agent": "Mozilla/5.0 MainlineRadar/3.0" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`sector page ${response.status}`);
    const html = await response.text();
    const pattern = /quote\.eastmoney\.com\/(?:sh|sz|bj)(\d{6})\.html[^"]*"[^>]*>\1<\/a>\s*<a[^>]*>([^<]+)<\/a>\s*<span data-percent[^>]*>\s*([-+]?\d+(?:\.\d+)?)%<\/span>/g;
    const seen = new Set<string>();
    const leaders: Leader[] = [];

    for (const match of html.matchAll(pattern)) {
      const [, code, rawName, rawChange] = match;
      if (seen.has(code)) continue;
      seen.add(code);
      leaders.push({
        rank: leaders.length ? "龙二" : "龙一",
        code,
        name: decodeHtml(rawName),
        change: Number(rawChange),
        constituentVerified: true,
      });
      if (leaders.length === 2) break;
    }

    if (leaders.length < 2) throw new Error("fewer than two verified constituents");
    return NextResponse.json({
      available: true,
      board,
      leaders,
      sourceLabel: "公开板块成分明细",
    }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" },
    });
  } catch {
    return NextResponse.json(
      { available: false, board, leaders: [], sourceLabel: "板块成分源暂时不可用" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
