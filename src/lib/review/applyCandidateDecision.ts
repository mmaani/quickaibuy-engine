import { pool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { BLOCKING_RISK_FLAGS, REVIEW_ACTION_STATUSES } from "@/lib/review/console";
import { validateProfitSafety } from "@/lib/profit/priceGuard";
import { PRODUCT_PIPELINE_MATCH_PREFERRED_MIN } from "@/lib/products/pipelinePolicy";
import { assertControlledMutationContext, assertLearningHubReady } from "@/lib/enforcement/runtimeSovereignty";

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
  match_status: string | null;
  match_confidence: string | null;
};

async function getCandidateById(candidateId: string): Promise<CandidateDecisionRow | null> {
  const candidateResult = await pool.query<CandidateDecisionRow>(
    `
      SELECT
        pc.id,
        pc.supplier_key,
        pc.supplier_product_id,
        pc.marketplace_key,
        pc.marketplace_listing_id,
        pc.decision_status,
        pc.risk_flags,
        m.status AS match_status,
        m.confidence::text AS match_confidence
      FROM profitable_candidates pc
      LEFT JOIN matches m
        ON m.supplier_key = pc.supplier_key
       AND m.supplier_product_id = pc.supplier_product_id
       AND m.marketplace_key = pc.marketplace_key
       AND m.marketplace_listing_id = pc.marketplace_listing_id
      WHERE pc.id = $1
      LIMIT 1
    `,
    [candidateId]
  );
  return candidateResult.rows[0] ?? null;
}

async function enqueueSupplierRefreshIfAvailable(input: { candidateId: string; reason: string }): Promise<void> {
  try {
    const mod = await import("@/lib/jobs/enqueueSupplierDiscover");
    await mod.enqueueSupplierDiscoverRefresh({
      idempotencySuffix: input.candidateId,
      reason: input.reason,
    });
  } catch {}
}

export async function applyCandidateDecision(input: {
  candidateId: string;
  requestedDecisionStatus: (typeof REVIEW_ACTION_STATUSES)[number];
  reason: string | null;
  actorId: string;
  actorType?: "ADMIN" | "WORKER" | "SYSTEM";
  source: "review-console" | "review-console-batch" | "review-worker";
  enforceBatchSafeApprove: boolean;
}): Promise<{
  ok: boolean;
  skipped?: string;
  previousStatus?: string;
  effectiveDecisionStatus?: string;
}> {
  const actorType = input.actorType ?? "WORKER";
  if (input.requestedDecisionStatus === "APPROVED") {
    await assertControlledMutationContext({
      blockedAction: "candidate_approval",
      path: "review/applyCandidateDecision",
      actorId: input.actorId,
      actorType,
      viaWorkerJob: actorType === "WORKER",
      controlledRepairPath: String(process.env.CONTROLLED_REPAIR_PATH ?? "false").trim().toLowerCase() === "true",
    });
    await assertLearningHubReady({
      blockedAction: "candidate_approval",
      path: "review/applyCandidateDecision",
      actorId: input.actorId,
      actorType,
      requiredDomains: ["supplier_intelligence", "shipping_intelligence", "opportunity_scores", "control_plane_scorecards"],
    });
  }

  const existing = await getCandidateById(input.candidateId);
  if (!existing) return { ok: false, skipped: "candidate_not_found" };

  const approvalReason = input.reason ?? `decision:${input.requestedDecisionStatus}`;
  let effectiveDecisionStatus: string = input.requestedDecisionStatus;
  let effectiveReason: string | null = approvalReason;
  let listingEligible = input.requestedDecisionStatus === "APPROVED" && existing.marketplace_key === "ebay";
  let listingBlockReason: string | null = listingEligible ? null : approvalReason;

  if (input.requestedDecisionStatus === "APPROVED" && input.enforceBatchSafeApprove) {
    if (!BATCH_APPROVE_ALLOWED_STATUSES.has(existing.decision_status)) return { ok: false, skipped: "status_requires_manual_review" };
    if (existing.marketplace_key !== "ebay") return { ok: false, skipped: "batch_approve_non_ebay_not_allowed" };
    if ((existing.risk_flags ?? []).some((flag) => BLOCKING_RISK_FLAGS.has(flag))) return { ok: false, skipped: "blocking_risk_flag" };
  }

  if (input.requestedDecisionStatus === "APPROVED" && existing.marketplace_key === "ebay") {
    const matchStatus = String(existing.match_status ?? "").trim().toUpperCase();
    const matchConfidence = existing.match_confidence == null || existing.match_confidence === "" ? null : Number(existing.match_confidence);
    const matchConfidenceApproved =
      matchStatus === "ACTIVE" &&
      matchConfidence != null &&
      Number.isFinite(matchConfidence) &&
      matchConfidence >= PRODUCT_PIPELINE_MATCH_PREFERRED_MIN;

    if (!matchConfidenceApproved) {
      effectiveDecisionStatus = "MANUAL_REVIEW";
      listingEligible = false;
      listingBlockReason = `MATCH_CONFIDENCE_GATE_FAILED: status=${matchStatus || "UNKNOWN"} confidence=${matchConfidence ?? "null"} min=${PRODUCT_PIPELINE_MATCH_PREFERRED_MIN}`;
      effectiveReason = listingBlockReason;
      if (input.enforceBatchSafeApprove) return { ok: false, skipped: "match_confidence_requires_manual_review" };
    }

    const priceGuard = await validateProfitSafety({ candidateId: input.candidateId, mode: "publish" });
    const supplierSnapshotAgeHours = priceGuard.metrics.supplier_snapshot_age_hours;
    const staleSupplierSnapshot = supplierSnapshotAgeHours != null && supplierSnapshotAgeHours > SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS;
    if (staleSupplierSnapshot) {
      await enqueueSupplierRefreshIfAvailable({ candidateId: input.candidateId, reason: "supplier-snapshot-age-gt-48h" });
    }

    if (!priceGuard.allow || priceGuard.metrics.supplier_price_drift_pct == null || supplierSnapshotAgeHours == null) {
      const reasons = [...priceGuard.reasons];
      if (priceGuard.metrics.supplier_price_drift_pct == null) reasons.push("SUPPLIER_DRIFT_DATA_REQUIRED");
      if (supplierSnapshotAgeHours == null) reasons.push("SUPPLIER_SNAPSHOT_AGE_REQUIRED");
      effectiveDecisionStatus = "MANUAL_REVIEW";
      listingEligible = false;
      listingBlockReason = `PRICE_GUARD_${priceGuard.decision}: ${priceGuard.reasonSummary} | codes: ${reasons.join(", ")}`;
      effectiveReason = listingBlockReason;
      if (input.enforceBatchSafeApprove) return { ok: false, skipped: "price_guard_requires_manual_review" };
    }
  }

  await pool.query(
    `
      UPDATE profitable_candidates
      SET
        decision_status = $2,
        reason = $3,
        approved_ts = CASE WHEN $2 = 'APPROVED' THEN COALESCE(approved_ts, NOW()) ELSE approved_ts END,
        approved_by = CASE WHEN $2 = 'APPROVED' THEN COALESCE(approved_by, $4) ELSE approved_by END,
        listing_eligible = $5,
        listing_eligible_ts = CASE WHEN $5 = TRUE THEN COALESCE(listing_eligible_ts, NOW()) ELSE NULL END,
        listing_block_reason = $6
      WHERE id = $1
    `,
    [input.candidateId, effectiveDecisionStatus, effectiveReason, input.actorId, listingEligible, listingBlockReason]
  );

  await writeAuditLog({
    actorType,
    actorId: input.actorId,
    entityType: "PROFITABLE_CANDIDATE",
    entityId: input.candidateId,
    eventType: `DECISION_${effectiveDecisionStatus}`,
    details: {
      previousStatus: existing.decision_status,
      nextStatus: effectiveDecisionStatus,
      reason: effectiveReason,
      supplierKey: existing.supplier_key,
      supplierProductId: existing.supplier_product_id,
      marketplaceKey: existing.marketplace_key,
      marketplaceListingId: existing.marketplace_listing_id,
      listingEligible,
      source: input.source,
    },
  });

  return { ok: true, previousStatus: existing.decision_status, effectiveDecisionStatus };
}
