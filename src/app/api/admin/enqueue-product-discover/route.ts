import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { enqueueProductDiscover } from "@/lib/jobs/enqueueTrendExpand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body: Record<string, unknown> = await req.json().catch(() => ({}));
  const candidateId = String(body.candidateId ?? "").trim();

  if (!candidateId) {
    return NextResponse.json({ ok: false, error: "candidateId required" }, { status: 400 });
  }

  const idempotencyKey = `product-discover-${candidateId}`;

  await db
    .insert(jobs)
    .values({
      jobType: "product:discover",
      idempotencyKey,
      payload: { candidateId },
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
        payload: { candidateId },
        status: "QUEUED",
        attempt: 0,
        maxAttempts: 3,
        scheduledTs: new Date(),
        startedTs: null,
        finishedTs: null,
        lastError: null,
      },
    });

  const job = await enqueueProductDiscover(candidateId);

  return NextResponse.json({
    ok: true,
    queue: "jobs",
    name: "product:discover",
    candidateId,
    jobId: String(job.id ?? idempotencyKey),
  });
}
