import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { handleMatchProductsJob } from "@/lib/jobs/matchProducts";
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
  const limit = clampInt(body.limit ?? searchParams.get("limit"), 25, 1, 200);
  const productRawId = String(body.productRawId ?? searchParams.get("productRawId") ?? "").trim() || undefined;

  const result = await handleMatchProductsJob({
    limit,
    productRawId,
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: auth.actorId,
    entityType: "PIPELINE",
    entityId: "match-products",
    eventType: "PIPELINE_MATCH_PRODUCTS_TRIGGERED",
    details: {
      source: "api/admin/pipeline/run-match-products",
      input: {
        limit,
        productRawId: productRawId ?? null,
      },
      result,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      stage: "match-products",
      result,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
