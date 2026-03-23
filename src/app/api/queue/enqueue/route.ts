import { NextResponse } from "next/server";
import { jobsQueue, jobNameFromUnknown } from "@/src/lib/bull";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { pool } from "@/lib/db";
import { BULL_PREFIX, JOBS_QUEUE_NAME } from "@/lib/jobNames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(req: Request) {
  const auth = requirePipelineAdmin(req);
  if (!auth.ok) {
    return auth.response;
  }

  const bodyRaw: unknown = await req.json().catch(() => ({}));
  const body = isRecord(bodyRaw) ? bodyRaw : {};

  let name: string;
  try {
    name = jobNameFromUnknown(body.name);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid job name",
      },
      { status: 400 }
    );
  }

  const payload = isRecord(body.payload) ? body.payload : {};
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : undefined;

  await pool.query(
    `
      INSERT INTO audit_log (actor_type, actor_id, entity_type, entity_id, event_type, details)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      "api",
      auth.actorId ?? "queue.enqueue",
      "job",
      idempotencyKey ?? null,
      "ENQUEUE",
      JSON.stringify({ name, payload, queue: JOBS_QUEUE_NAME, prefix: BULL_PREFIX }),
    ]
  );

  const job = await jobsQueue.add(name, payload, {
    jobId: idempotencyKey,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 5000,
    },
    removeOnFail: false,
  });

  return NextResponse.json({
    ok: true,
    queue: JOBS_QUEUE_NAME,
    prefix: BULL_PREFIX,
    name,
    jobId: job.id,
  });
}
