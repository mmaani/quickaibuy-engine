import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { enqueueProfitEval } from "@/lib/jobs/enqueueProfitEval";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export async function POST(request: Request) {
  const auth = requirePipelineAdmin(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { searchParams } = new URL(request.url);
  const limit = clampInt(body.limit ?? searchParams.get("limit"), 25, 1, 300);

  const job = await enqueueProfitEval({
    limit,
    idempotencySuffix: `manual-${Date.now()}`,
    triggerSource: "manual",
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: auth.actorId,
    entityType: "PIPELINE",
    entityId: "profit-engine",
    eventType: "PIPELINE_PROFIT_ENGINE_TRIGGERED",
    details: {
      source: "api/admin/pipeline/run-profit-engine",
      input: {
        limit,
      },
      enqueuedJob: {
        id: String(job.id),
        name: job.name,
      },
    },
  });

  return NextResponse.json(
    {
      ok: true,
      stage: "profit-engine",
      enqueued: true,
      jobId: String(job.id),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
