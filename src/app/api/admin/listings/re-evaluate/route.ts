import { NextResponse } from "next/server";
import { reevaluateListingForRecovery } from "@/lib/listings/recovery";
import { LISTINGS_ROUTE } from "@/lib/listings/getApprovedListingsQueueData";
import {
  REVIEW_CONSOLE_REALM,
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Basic realm="${REVIEW_CONSOLE_REALM}"`,
        "Cache-Control": "no-store",
      },
    }
  );
}

function buildRedirectUrl(request: Request): URL {
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer);
    } catch {}
  }
  return new URL(LISTINGS_ROUTE, request.url);
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(authorization)) {
    return unauthorizedResponse();
  }

  const formData = await request.formData();
  const listingId = String(formData.get("listingId") ?? "").trim();
  const candidateId = String(formData.get("candidateId") ?? "").trim();
  if (!listingId) {
    return NextResponse.json({ ok: false, error: "listingId required" }, { status: 400 });
  }

  const result = await reevaluateListingForRecovery({
    listingId,
    actorType: "ADMIN",
    actorId: getReviewActorIdFromAuthorizationHeader(authorization) ?? "admin-listings",
  });

  const redirectUrl = buildRedirectUrl(request);
  if (candidateId) redirectUrl.searchParams.set("candidateId", candidateId);

  if (!result.ok) {
    redirectUrl.searchParams.set("reevaluateBlocked", "1");
    redirectUrl.searchParams.set("reevaluateReason", result.reason ?? "Re-evaluation failed");
    if (result.recoveryState) redirectUrl.searchParams.set("reevaluateState", result.recoveryState);
    if (result.nextAction) redirectUrl.searchParams.set("reevaluateNextAction", result.nextAction);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  redirectUrl.searchParams.set("reevaluateUpdated", "1");
  redirectUrl.searchParams.set("reevaluateDecision", result.decision ?? "READY_FOR_REPROMOTION");
  if (result.recoveryState) redirectUrl.searchParams.set("reevaluateState", result.recoveryState);
  if (result.nextAction) redirectUrl.searchParams.set("reevaluateNextAction", result.nextAction);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
