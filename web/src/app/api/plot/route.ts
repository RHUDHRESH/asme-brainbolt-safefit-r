import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { plotPath } from "@/lib/server-metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const file = plotPath();
  if (!existsSync(file)) {
    return new NextResponse("Plot not found", { status: 404 });
  }

  const bytes = await readFile(file);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
