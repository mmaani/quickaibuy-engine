import { NextResponse } from "next/server";
import { engineQueue } from "@/src/lib/bull";
import { JOBS } from "@/src/lib/jobNames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      {
        ok: false,
        error: "queue test route disabled outside development",
      },
      { status: 404 }
    );
  }

  const job = await engineQueue.add(JOBS.SCAN_SUPPLIER, {
    source: "demo",
    url: "https://example.com",
  });

  return NextResponse.json({
    ok: true,
    jobId: job.id,
  });
}
