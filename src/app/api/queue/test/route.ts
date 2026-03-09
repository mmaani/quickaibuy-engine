import { NextResponse } from "next/server";
import { engineQueue } from "@/src/lib/bull";
import { JOBS } from "@/src/lib/jobNames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const job = await engineQueue.add(JOBS.SCAN_SUPPLIER, {
    source: "demo",
    url: "https://example.com",
  });

  return NextResponse.json({
    ok: true,
    jobId: job.id,
  });
}
