import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { allocateQueryBudget } from "@/lib/queryBudget/allocator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = requirePipelineAdmin(req);
  if (!auth.ok) return auth.response;

  const body: Record<string, unknown> = await req.json().catch(() => ({}));
  const candidateScanLimit = Number(body.candidateScanLimit ?? 300);

  const result = await allocateQueryBudget({
    candidateScanLimit: Number.isFinite(candidateScanLimit) ? candidateScanLimit : 300,
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
