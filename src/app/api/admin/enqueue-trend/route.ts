import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { jobsQueue } from "@/lib/bull";
import { JOB_NAMES } from "@/lib/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";
import type { TrendIngestJob } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = requirePipelineAdmin(req);
  if (!auth.ok) return auth.response;

  const body: Record<string, unknown> = await req.json().catch(() => ({}));
  const signalValue = String(body.signalValue ?? "").trim();
  if (!signalValue) {
    return NextResponse.json({ ok: false, error: "signalValue required" }, { status: 400 });
  }

  const payload: TrendIngestJob = {
    source: "manual",
    signalType: "keyword",
    signalValue,
    region: body.region != null ? String(body.region) : undefined,
    score: body.score != null ? Number(body.score) : undefined,
    rawPayload: body.rawPayload,
  };

  const idempotencyKey = `trend-manual-keyword-${signalValue.toLowerCase().replace(/\s+/g, "-")}-${
    payload.region ?? "global"
  }`;

  const job = await jobsQueue.add(
    JOB_NAMES.TREND_INGEST,
    { ...payload, triggerSource: "manual" },
    {
      jobId: idempotencyKey,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }
  );

  await markJobQueued({
    jobType: JOB_NAMES.TREND_INGEST,
    idempotencyKey: String(job.id),
    payload: { ...payload, triggerSource: "manual" },
    attempt: 0,
    maxAttempts: 3,
  });

  return NextResponse.json({ ok: true, jobId: String(job.id) });
}
