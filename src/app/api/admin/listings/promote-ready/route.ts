import { NextResponse } from "next/server";
import { markListingReadyToPublish } from "@/lib/listings/markListingReadyToPublish";
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

  let result;
  try {
    result = await markListingReadyToPublish({
      listingId,
      actorType: "ADMIN",
      actorId: getReviewActorIdFromAuthorizationHeader(authorization) ?? "admin-listings",
    });
  } catch (error) {
    const redirectUrl = buildRedirectUrl(request);
    if (candidateId) redirectUrl.searchParams.set("candidateId", candidateId);
    redirectUrl.searchParams.set(
      "promoteError",
      error instanceof Error ? error.message : "Canonical execution enforcement blocked promotion"
    );
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  const redirectUrl = buildRedirectUrl(request);
  if (candidateId) redirectUrl.searchParams.set("candidateId", candidateId);

  if (!result.ok) {
    redirectUrl.searchParams.set("promoteError", result.reason ?? "Unable to promote preview");
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  redirectUrl.searchParams.set("promoteUpdated", "1");
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
