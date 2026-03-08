import { NextResponse } from "next/server";
import { REVIEW_ROUTE } from "@/lib/review/console";
import {
  PrepareListingPreviewError,
  prepareListingPreviewForCandidate,
} from "@/lib/listings/prepareListingPreviews";
import { isAuthorizedReviewAuthorizationHeader, isReviewConsoleConfigured } from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildRedirectUrl(request: Request): URL {
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer);
    } catch {}
  }

  return new URL(REVIEW_ROUTE, request.url);
}

function parseForceRefresh(input: FormDataEntryValue | null): boolean {
  const value = String(input ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(authorization)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const candidateId = String(formData.get("candidateId") ?? "").trim();
  const marketplace = String(formData.get("marketplace") ?? "ebay").trim().toLowerCase() as
    | "ebay"
    | "amazon";
  const forceRefresh = parseForceRefresh(formData.get("forceRefresh"));

  if (!candidateId) {
    return NextResponse.json({ ok: false, error: "candidateId required" }, { status: 400 });
  }
  if (marketplace !== "ebay" && marketplace !== "amazon") {
    return NextResponse.json({ ok: false, error: "invalid marketplace" }, { status: 400 });
  }

  const redirectUrl = buildRedirectUrl(request);
  redirectUrl.searchParams.set("candidateId", candidateId);

  try {
    const result = await prepareListingPreviewForCandidate(candidateId, {
      marketplace,
      forceRefresh,
    });

    redirectUrl.searchParams.set("previewUpdated", "1");
    redirectUrl.searchParams.set("previewMarketplace", result.marketplace);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    if (error instanceof PrepareListingPreviewError) {
      redirectUrl.searchParams.set("previewError", error.message);
      return NextResponse.redirect(redirectUrl, { status: 303 });
    }

    throw error;
  }
}
