import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { handleMarketplaceScanJob } from "@/lib/jobs/marketplaceScan";
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
  const limit = clampInt(body.limit ?? searchParams.get("limit"), 25, 1, 100);
  const productRawId = String(body.productRawId ?? searchParams.get("productRawId") ?? "").trim() || undefined;
  const platformRaw = String(body.platform ?? searchParams.get("platform") ?? "ebay").trim().toLowerCase();

  if (platformRaw !== "ebay" && platformRaw !== "amazon" && platformRaw !== "all") {
    return NextResponse.json({ ok: false, error: "platform must be one of: ebay, amazon, all" }, { status: 400 });
  }

  const platform = (platformRaw === "all" ? "ebay" : platformRaw) as "ebay" | "amazon";

  const result = await handleMarketplaceScanJob({
    limit,
    productRawId,
    platform,
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: auth.actorId,
    entityType: "PIPELINE",
    entityId: "marketplace-scan",
    eventType: "PIPELINE_MARKETPLACE_SCAN_TRIGGERED",
    details: {
      source: "api/admin/pipeline/run-marketplace-scan",
      input: {
        limit,
        productRawId: productRawId ?? null,
        platform,
      },
      result,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      stage: "marketplace-scan",
      result,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
