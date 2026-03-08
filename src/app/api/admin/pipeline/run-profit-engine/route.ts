import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { runProfitEngine } from "@/lib/profit/profitEngine";
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

  const result = await runProfitEngine({
    limit,
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
      result,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      stage: "profit-engine",
      result,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
