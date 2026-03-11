import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { REVIEW_ACTION_STATUSES, REVIEW_ROUTE } from "@/lib/review/console";
import { validateProfitSafety } from "@/lib/profit/priceGuard";
import { enqueueSupplierDiscoverRefresh } from "@/lib/jobs/enqueueSupplierDiscover";
import {
  REVIEW_CONSOLE_REALM,
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS = 48;

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
  let effectiveDecisionStatus = decisionStatus;
  let listingEligible = decisionStatus === "APPROVED" && existing.marketplace_key === "ebay";
  let listingBlockReason: string | null = listingEligible ? null : approvalReason;

  if (decisionStatus === "APPROVED" && existing.marketplace_key === "ebay") {
    const priceGuard = await validateProfitSafety({
      candidateId,
      mode: "publish",
    });
    const driftMetricAvailable = priceGuard.metrics.supplier_price_drift_pct != null;
    const supplierSnapshotAgeHours = priceGuard.metrics.supplier_snapshot_age_hours;
    const supplierSnapshotAgeAvailable = supplierSnapshotAgeHours != null;
    const staleSupplierSnapshot =
      supplierSnapshotAgeHours != null &&
      supplierSnapshotAgeHours > SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS;

    if (staleSupplierSnapshot) {
      try {
        await enqueueSupplierDiscoverRefresh({
          idempotencySuffix: candidateId,
          reason: "supplier-snapshot-age-gt-48h",
        });
      } catch {}
    }

    if (!priceGuard.allow || !driftMetricAvailable || !supplierSnapshotAgeAvailable) {
      const reasons = [...priceGuard.reasons];
      if (!driftMetricAvailable) reasons.push("SUPPLIER_DRIFT_DATA_REQUIRED");
      if (!supplierSnapshotAgeAvailable) reasons.push("SUPPLIER_SNAPSHOT_AGE_REQUIRED");
      effectiveDecisionStatus = "MANUAL_REVIEW";
      listingEligible = false;
      listingBlockReason = `PRICE_GUARD_${priceGuard.decision}: ${reasons.join(", ")}`;
    }
  }

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
        listing_eligible = $5,
        listing_eligible_ts = CASE
          WHEN $5 = TRUE THEN COALESCE(listing_eligible_ts, NOW())
          ELSE NULL
        END,
        listing_block_reason = $6
      WHERE id = $1
    `,
    [candidateId, effectiveDecisionStatus, reason, actorId, listingEligible, listingBlockReason]
  );

  await writeAuditLog({
    actorType: "ADMIN",
    actorId,
    entityType: "PROFITABLE_CANDIDATE",
    entityId: candidateId,
    eventType: `DECISION_${effectiveDecisionStatus}`,
    details: {
      previousStatus: existing.decision_status,
      nextStatus: effectiveDecisionStatus,
      reason,
      supplierKey: existing.supplier_key,
      supplierProductId: existing.supplier_product_id,
      marketplaceKey: existing.marketplace_key,
      marketplaceListingId: existing.marketplace_listing_id,
      listingEligible,
      source: "review-console",
    },
  });

  const redirectUrl = buildRedirectUrl(request);
  redirectUrl.searchParams.set("decisionStatus", effectiveDecisionStatus);
  redirectUrl.searchParams.delete("riskOnly");
  redirectUrl.searchParams.set("candidateId", candidateId);
  redirectUrl.searchParams.set("updated", "1");
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
