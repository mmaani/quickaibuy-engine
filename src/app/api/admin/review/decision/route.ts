import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { REVIEW_ACTION_STATUSES, REVIEW_ROUTE } from "@/lib/review/console";
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

  return new URL(REVIEW_ROUTE, request.url);
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(authorization)) {
    return unauthorizedResponse();
  }

  const formData = await request.formData();
  const candidateId = String(formData.get("candidateId") ?? "").trim();
  const decisionStatus = String(formData.get("decisionStatus") ?? "").trim().toUpperCase();
  const reasonValue = String(formData.get("reason") ?? "").trim();
  const reason = reasonValue ? reasonValue : null;
  const actorId = getReviewActorIdFromAuthorizationHeader(authorization);

  if (!candidateId) {
    return NextResponse.json({ ok: false, error: "candidateId required" }, { status: 400 });
  }

  if (!REVIEW_ACTION_STATUSES.includes(decisionStatus as (typeof REVIEW_ACTION_STATUSES)[number])) {
    return NextResponse.json({ ok: false, error: "invalid decisionStatus" }, { status: 400 });
  }

  const candidateResult = await pool.query<{
    id: string;
    supplier_key: string;
    supplier_product_id: string;
    marketplace_key: string;
    marketplace_listing_id: string;
    decision_status: string;
  }>(
    `
      SELECT id, supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id, decision_status
      FROM profitable_candidates
      WHERE id = $1
      LIMIT 1
    `,
    [candidateId]
  );

  const existing = candidateResult.rows[0];
  if (!existing) {
    return NextResponse.json({ ok: false, error: "candidate not found" }, { status: 404 });
  }

  const approvalReason = reason ?? `decision:${decisionStatus}`;

  await pool.query(
    `
      UPDATE profitable_candidates
      SET
        decision_status = $2,
        reason = $3,
        approved_ts = CASE
          WHEN $2 = 'APPROVED' THEN COALESCE(approved_ts, NOW())
          ELSE approved_ts
        END,
        approved_by = CASE
          WHEN $2 = 'APPROVED' THEN COALESCE(approved_by, $4)
          ELSE approved_by
        END,
        listing_eligible = CASE
          WHEN $2 = 'APPROVED' AND marketplace_key = 'ebay' THEN TRUE
          ELSE FALSE
        END,
        listing_eligible_ts = CASE
          WHEN $2 = 'APPROVED' AND marketplace_key = 'ebay' THEN COALESCE(listing_eligible_ts, NOW())
          ELSE NULL
        END,
        listing_block_reason = CASE
          WHEN $2 = 'APPROVED' AND marketplace_key = 'ebay' THEN NULL
          ELSE $5
        END
      WHERE id = $1
    `,
    [candidateId, decisionStatus, reason, actorId, approvalReason]
  );

  await writeAuditLog({
    actorType: "ADMIN",
    actorId,
    entityType: "PROFITABLE_CANDIDATE",
    entityId: candidateId,
    eventType: `DECISION_${decisionStatus}`,
    details: {
      previousStatus: existing.decision_status,
      nextStatus: decisionStatus,
      reason,
      supplierKey: existing.supplier_key,
      supplierProductId: existing.supplier_product_id,
      marketplaceKey: existing.marketplace_key,
      marketplaceListingId: existing.marketplace_listing_id,
      listingEligible: decisionStatus === "APPROVED" && existing.marketplace_key === "ebay",
      source: "review-console",
    },
  });

  const redirectUrl = buildRedirectUrl(request);
  redirectUrl.searchParams.set("decisionStatus", decisionStatus);
  redirectUrl.searchParams.delete("riskOnly");
  redirectUrl.searchParams.set("candidateId", candidateId);
  redirectUrl.searchParams.set("updated", "1");
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
