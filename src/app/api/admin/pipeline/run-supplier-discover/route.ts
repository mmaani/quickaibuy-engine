import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { enqueueSupplierDiscoverRefresh } from "@/lib/jobs/enqueueSupplierDiscover";
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
  const limitPerKeyword = clampInt(
    body.limitPerKeyword ?? searchParams.get("limitPerKeyword"),
    10,
    1,
    50
  );

  const job = await enqueueSupplierDiscoverRefresh({
    limitPerKeyword,
    idempotencySuffix: `manual-${Date.now()}`,
    reason: "manual-api-trigger",
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: auth.actorId,
    entityType: "PIPELINE",
    entityId: "supplier-discover",
    eventType: "PIPELINE_SUPPLIER_DISCOVER_TRIGGERED",
    details: {
      source: "api/admin/pipeline/run-supplier-discover",
      input: {
        limitPerKeyword,
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
      stage: "supplier-discover",
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
