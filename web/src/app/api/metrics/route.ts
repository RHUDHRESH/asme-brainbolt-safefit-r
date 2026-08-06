import { NextResponse } from "next/server";

import { loadMetrics } from "@/lib/server-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const resume = searchParams.get("resume") === "1";
    const metrics = await loadMetrics({ resume });
    return NextResponse.json(metrics);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
