import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { getQueue } from "@/lib/queue/bullmq";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
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

  await db
    .insert(jobs)
    .values({
      jobType: "trend:ingest",
      idempotencyKey,
      payload,
      status: "QUEUED",
      attempt: 0,
      maxAttempts: 3,
      scheduledTs: new Date(),
      startedTs: null,
      finishedTs: null,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [jobs.jobType, jobs.idempotencyKey],
      set: {
        payload,
        status: "QUEUED",
        attempt: 0,
        maxAttempts: 3,
        scheduledTs: new Date(),
        startedTs: null,
        finishedTs: null,
        lastError: null,
      },
    });

  const q = getQueue("trend-ingest");
  await q.add("trend:ingest", payload, { jobId: idempotencyKey });

  return NextResponse.json({ ok: true, jobId: idempotencyKey });
}
