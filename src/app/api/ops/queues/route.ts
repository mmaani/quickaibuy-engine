import { NextResponse } from "next/server";
import { jobsQueue } from "@/src/lib/bull";
import { BULL_PREFIX, JOBS_QUEUE_NAME } from "@/src/lib/jobNames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const counts = await jobsQueue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
      "prioritized",
      "waiting-children"
    );

    return NextResponse.json({
      ok: true,
      queue: JOBS_QUEUE_NAME,
      prefix: BULL_PREFIX,
      counts,
      workerPath: "jobs.worker",
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
