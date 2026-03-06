import { NextResponse } from "next/server";
import { queues } from "@/src/lib/bull";
import { jobNameFromUnknown } from "@/src/lib/bull";
import { JOBS } from "@/src/lib/jobNames";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;
function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(req: Request) {
  const bodyRaw: unknown = await req.json().catch(() => ({}));
  const body = isRecord(bodyRaw) ? bodyRaw : {};

  const name = jobNameFromUnknown(body.name);
  const payload = isRecord(body.payload) ? body.payload : {};
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;

  // Basic audit log
  await pool.query(
    `
      INSERT INTO audit_log (actor_type, actor_id, entity_type, entity_id, event_type, details)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      "api",
      "queue.enqueue",
      "job",
      idempotencyKey ?? `job:${Date.now()}`,
      "ENQUEUE",
      JSON.stringify({ name, payload }),
    ]
  );

  const job = await queues.engine.add(
    name,
    payload,
    {
      jobId: idempotencyKey, // idempotency if provided
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600, count: 5000 },
      removeOnFail: false,
    }
  );

  return NextResponse.json({
    ok: true,
    queue: "engine",
    name,
    jobId: job.id,
    supported: Object.values(JOBS),
  });
}
