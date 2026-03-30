import { NextResponse } from "next/server";
import { REVIEW_ROUTE } from "@/lib/review/console";
import {
  REVIEW_CONSOLE_REALM,
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";
import { enqueueReviewPreparePreviewJob } from "@/lib/jobs/enqueueAdminMutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": `Basic realm="${REVIEW_CONSOLE_REALM}"`, "Cache-Control": "no-store" } }
  );
}

function buildRedirectUrl(request: Request): URL {
  const referer = request.headers.get("referer");
  if (referer) {
    try { return new URL(referer); } catch {}
  }
  return new URL(REVIEW_ROUTE, request.url);
}

function parseForceRefresh(input: FormDataEntryValue | null): boolean {
  const value = String(input ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(authorization)) return unauthorizedResponse();

  const formData = await request.formData();
  const candidateId = String(formData.get("candidateId") ?? "").trim();
  const marketplace = String(formData.get("marketplace") ?? "ebay").trim().toLowerCase() as "ebay" | "amazon";
  const forceRefresh = parseForceRefresh(formData.get("forceRefresh"));

  if (!candidateId) return NextResponse.json({ ok: false, error: "candidateId required" }, { status: 400 });
  if (marketplace !== "ebay" && marketplace !== "amazon") return NextResponse.json({ ok: false, error: "invalid marketplace" }, { status: 400 });

  const actorId = getReviewActorIdFromAuthorizationHeader(authorization) ?? "review-console";
  const job = await enqueueReviewPreparePreviewJob({
    actorId,
    triggerSource: "review-console",
    payload: { candidateId, marketplace, forceRefresh },
    idempotencySuffix: `${candidateId}-${Date.now()}`,
  });

  const redirectUrl = buildRedirectUrl(request);
  redirectUrl.searchParams.set("candidateId", candidateId);
  redirectUrl.searchParams.set("previewQueued", "1");
  redirectUrl.searchParams.set("jobId", String(job.id));
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
