import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { BLOCKING_RISK_FLAGS, REVIEW_ACTION_STATUSES, REVIEW_ROUTE } from "@/lib/review/console";
import { validateProfitSafety } from "@/lib/profit/priceGuard";
import {
  REVIEW_CONSOLE_REALM,
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS = 48;
const BATCH_APPROVE_ALLOWED_STATUSES = new Set(["PENDING", "RECHECK", "APPROVED"]);

type CandidateDecisionRow = {
  id: string;
  supplier_key: string;
  supplier_product_id: string;
  marketplace_key: string;
  marketplace_listing_id: string;
  decision_status: string;
  risk_flags: string[] | null;
};

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

function redirectWithError(request: Request, message: string): NextResponse {
  const redirectUrl = buildRedirectUrl(request);
  redirectUrl.searchParams.set("decisionError", message);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}

async function getCandidateById(candidateId: string): Promise<CandidateDecisionRow | null> {
  const candidateResult = await pool.query<CandidateDecisionRow>(
    `
      SELECT id, supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id, decision_status, risk_flags
      FROM profitable_candidates
      WHERE id = $1
      LIMIT 1
    `,
    [candidateId]
  );
  return candidateResult.rows[0] ?? null;
}

async function enqueueSupplierRefreshIfAvailable(input: {
  candidateId: string;
  reason: string;
}): Promise<void> {
  try {
    const mod = await import("@/lib/jobs/enqueueSupplierDiscover");
    await mod.enqueueSupplierDiscoverRefresh({
      idempotencySuffix: input.candidateId,
      reason: input.reason,
    });
  } catch {}
}

async function applyCandidateDecision(input: {
  candidateId: string;
  requestedDecisionStatus: (typeof REVIEW_ACTION_STATUSES)[number];
  reason: string | null;
  actorId: string;
  source: "review-console" | "review-console-batch";
  enforceBatchSafeApprove: boolean;
}): Promise<{
  ok: boolean;
  skipped?: string;
  previousStatus?: string;
  effectiveDecisionStatus?: string;
}> {
  const existing = await getCandidateById(input.candidateId);
  if (!existing) {
    return { ok: false, skipped: "candidate_not_found" };
  }

  const approvalReason = input.reason ?? `decision:${input.requestedDecisionStatus}`;
  let effectiveDecisionStatus: string = input.requestedDecisionStatus;
  let listingEligible =
    input.requestedDecisionStatus === "APPROVED" && existing.marketplace_key === "ebay";
  let listingBlockReason: string | null = listingEligible ? null : approvalReason;

  if (input.requestedDecisionStatus === "APPROVED" && input.enforceBatchSafeApprove) {
    if (!BATCH_APPROVE_ALLOWED_STATUSES.has(existing.decision_status)) {
      return { ok: false, skipped: "status_requires_manual_review" };
    }

    if (existing.marketplace_key !== "ebay") {
      return { ok: false, skipped: "batch_approve_non_ebay_not_allowed" };
    }

    if ((existing.risk_flags ?? []).some((flag) => BLOCKING_RISK_FLAGS.has(flag))) {
      return { ok: false, skipped: "blocking_risk_flag" };
    }
  }

  if (input.requestedDecisionStatus === "APPROVED" && existing.marketplace_key === "ebay") {
    const priceGuard = await validateProfitSafety({
      candidateId: input.candidateId,
      mode: "publish",
    });
    const driftMetricAvailable = priceGuard.metrics.supplier_price_drift_pct != null;
    const supplierSnapshotAgeHours = priceGuard.metrics.supplier_snapshot_age_hours;
    const supplierSnapshotAgeAvailable = supplierSnapshotAgeHours != null;
    const staleSupplierSnapshot =
      supplierSnapshotAgeHours != null &&
      supplierSnapshotAgeHours > SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS;

    if (staleSupplierSnapshot) {
      await enqueueSupplierRefreshIfAvailable({
        candidateId: input.candidateId,
        reason: "supplier-snapshot-age-gt-48h",
      });
    }

    if (!priceGuard.allow || !driftMetricAvailable || !supplierSnapshotAgeAvailable) {
      const reasons = [...priceGuard.reasons];
      if (!driftMetricAvailable) reasons.push("SUPPLIER_DRIFT_DATA_REQUIRED");
      if (!supplierSnapshotAgeAvailable) reasons.push("SUPPLIER_SNAPSHOT_AGE_REQUIRED");
      effectiveDecisionStatus = "MANUAL_REVIEW";
      listingEligible = false;
      listingBlockReason = `PRICE_GUARD_${priceGuard.decision}: ${reasons.join(", ")}`;

      if (input.enforceBatchSafeApprove) {
        return { ok: false, skipped: "price_guard_requires_manual_review" };
      }
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
    [input.candidateId, effectiveDecisionStatus, input.reason, input.actorId, listingEligible, listingBlockReason]
  );

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: input.actorId,
    entityType: "PROFITABLE_CANDIDATE",
    entityId: input.candidateId,
    eventType: `DECISION_${effectiveDecisionStatus}`,
    details: {
      previousStatus: existing.decision_status,
      nextStatus: effectiveDecisionStatus,
      reason: input.reason,
      supplierKey: existing.supplier_key,
      supplierProductId: existing.supplier_product_id,
      marketplaceKey: existing.marketplace_key,
      marketplaceListingId: existing.marketplace_listing_id,
      listingEligible,
      source: input.source,
    },
  });

  return {
    ok: true,
    previousStatus: existing.decision_status,
    effectiveDecisionStatus,
  };
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(authorization)) {
    return unauthorizedResponse();
  }

  try {
    const formData = await request.formData();
    const decisionStatus = String(formData.get("decisionStatus") ?? "")
      .trim()
      .toUpperCase();
    const reasonValue = String(formData.get("reason") ?? "").trim();
    const reason = reasonValue ? reasonValue : null;
    const actorId = getReviewActorIdFromAuthorizationHeader(authorization) ?? "review-console";

    if (!REVIEW_ACTION_STATUSES.includes(decisionStatus as (typeof REVIEW_ACTION_STATUSES)[number])) {
      return redirectWithError(request, "Choose Approve, Reject, or Mark for Recheck before submitting.");
    }

    const redirectUrl = buildRedirectUrl(request);
    const batchCandidateIds = formData
      .getAll("candidateIds")
      .map((value) => String(value).trim())
      .filter(Boolean);

    if (batchCandidateIds.length > 0) {
      const uniqueCandidateIds = Array.from(new Set(batchCandidateIds));

      let appliedCount = 0;
      let skippedCount = 0;
      const skippedReasons: Record<string, number> = {};

      for (const candidateId of uniqueCandidateIds) {
        const result = await applyCandidateDecision({
          candidateId,
          requestedDecisionStatus: decisionStatus as (typeof REVIEW_ACTION_STATUSES)[number],
          reason,
          actorId,
          source: "review-console-batch",
          enforceBatchSafeApprove: decisionStatus === "APPROVED",
        });

        if (result.ok) {
          appliedCount += 1;
        } else {
          skippedCount += 1;
          const key = result.skipped ?? "unknown";
          skippedReasons[key] = (skippedReasons[key] ?? 0) + 1;
        }
      }

      redirectUrl.searchParams.set("batchUpdated", "1");
      redirectUrl.searchParams.set("batchAction", decisionStatus);
      redirectUrl.searchParams.set("batchApplied", String(appliedCount));
      redirectUrl.searchParams.set("batchSkipped", String(skippedCount));
      if (Object.keys(skippedReasons).length > 0) {
        redirectUrl.searchParams.set("batchSkipSummary", JSON.stringify(skippedReasons));
      } else {
        redirectUrl.searchParams.delete("batchSkipSummary");
      }

      return NextResponse.redirect(redirectUrl, { status: 303 });
    }

    const candidateId = String(formData.get("candidateId") ?? "").trim();
    if (!candidateId) {
      return redirectWithError(request, "Candidate ID is required for a review decision.");
    }

    const result = await applyCandidateDecision({
      candidateId,
      requestedDecisionStatus: decisionStatus as (typeof REVIEW_ACTION_STATUSES)[number],
      reason,
      actorId,
      source: "review-console",
      enforceBatchSafeApprove: false,
    });

    if (!result.ok) {
      return redirectWithError(request, result.skipped ?? "Review decision could not be applied.");
    }

    redirectUrl.searchParams.set("decisionStatus", result.effectiveDecisionStatus ?? decisionStatus);
    redirectUrl.searchParams.delete("riskOnly");
    redirectUrl.searchParams.set("candidateId", candidateId);
    redirectUrl.searchParams.set("updated", "1");
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review decision failed.";
    return redirectWithError(request, message);
  }
}
