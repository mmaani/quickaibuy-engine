import { NextResponse } from "next/server";
import { engineQueue, jobNameFromUnknown } from "@/src/lib/bull";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(req: Request) {
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
      "queue.enqueue",
      "job",
      idempotencyKey ?? null,
      "ENQUEUE",
      JSON.stringify({ name, payload }),
    ]
  );

  const job = await engineQueue.add(name, payload, {
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
    queue: "engine",
    name,
    jobId: job.id,
  });
}
