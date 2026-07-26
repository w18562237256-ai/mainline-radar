import { NextResponse } from "next/server";
import snapshot from "../../../public/market-data.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "CDN-Cache-Control": "no-store",
      "X-Market-Revision": snapshot.dataRevision,
    },
  });
}
