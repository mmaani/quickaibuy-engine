import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

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
  const attemptedName = typeof body.name === "string" ? body.name : null;
  const attemptedAction = typeof body.actionKey === "string" ? body.actionKey : null;
  const attemptedSource = typeof body.source === "string" ? body.source : null;
  const attemptedIdempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : null;

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: auth.actorId ?? "queue.enqueue",
    entityType: "CONTROL_PLANE",
    entityId: "/api/queue/enqueue",
    eventType: "CANONICAL_ENFORCEMENT_BLOCKED",
    details: {
      code: "GENERIC_ENQUEUE_SURFACE_RETIRED",
      severity: "CRITICAL",
      violationType: "generic_queue_enqueue_blocked",
      blockedAction: attemptedAction ?? attemptedName ?? "unknown",
      executionPath: "api/queue/enqueue",
      reason: "generic enqueue API retired; action-keyed control-plane wrappers are mandatory",
      attemptedName,
      attemptedAction,
      attemptedSource,
      attemptedIdempotencyKey,
    },
  });

  return NextResponse.json({
    ok: false,
    error: "canonical enqueue enforcement: /api/queue/enqueue is retired; use typed control-plane action wrappers",
    code: "GENERIC_ENQUEUE_SURFACE_RETIRED",
  }, { status: 410 });
}
