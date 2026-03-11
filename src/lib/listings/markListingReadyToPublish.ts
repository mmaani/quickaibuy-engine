import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { validateProfitSafety } from "@/lib/profit/priceGuard";
import { enqueueSupplierDiscoverRefresh } from "@/lib/jobs/enqueueSupplierDiscover";
import { enqueueMarketplacePriceScan } from "@/lib/jobs/enqueueMarketplacePriceScan";

export type MarkListingReadyInput = {
  listingId: string;
  actorId?: string;
  actorType?: "ADMIN" | "WORKER" | "SYSTEM";
};

export type MarkListingReadyResult = {
  ok: boolean;
  listingId: string;
  candidateId?: string;
  marketplaceKey?: string;
  previousStatus?: string;
  newStatus?: "READY_TO_PUBLISH";
  reason?: string;
};

function normalizeActorType(value?: string): "ADMIN" | "WORKER" | "SYSTEM" {
  if (value === "ADMIN" || value === "WORKER") return value;
  return "SYSTEM";
}

// Supplier snapshot older than 48h triggers refresh enqueue and blocks readiness.
const SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS = 48;

export async function markListingReadyToPublish(
  input: MarkListingReadyInput
): Promise<MarkListingReadyResult> {
  const actorId = input.actorId ?? "markListingReadyToPublish";
  const actorType = normalizeActorType(input.actorType);

  const current = await db.execute(sql`
    SELECT
      l.id,
      l.candidate_id AS "candidateId",
      l.marketplace_key AS "marketplaceKey",
      l.status,
      pc.decision_status AS "decisionStatus",
      pc.listing_eligible AS "listingEligible"
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.id = ${input.listingId}
    LIMIT 1
  `);

  const row = current.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return {
      ok: false,
      listingId: input.listingId,
      reason: "listing not found",
    };
  }

  const candidateId = String(row.candidateId ?? "");
  const marketplaceKey = String(row.marketplaceKey ?? "");
  const previousStatus = String(row.status ?? "");
  const decisionStatus = String(row.decisionStatus ?? "");
  const listingEligible = Boolean(row.listingEligible);

  if (marketplaceKey !== "ebay") {
    return {
      ok: false,
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      reason: "v1 ready-to-publish only supports ebay",
    };
  }

  if (previousStatus !== "PREVIEW") {
    return {
      ok: false,
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      reason: "listing must be in PREVIEW status",
    };
  }

  if (decisionStatus !== "APPROVED") {
    return {
      ok: false,
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      reason: "candidate is not APPROVED",
    };
  }

  if (!listingEligible) {
    return {
      ok: false,
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      reason: "candidate is not listing eligible",
    };
  }

  const priceGuard = await validateProfitSafety({
    candidateId,
    listingId: input.listingId,
    mode: "publish",
  });
  const driftMetricAvailable = priceGuard.metrics.supplier_price_drift_pct != null;
  const supplierSnapshotAgeHours = priceGuard.metrics.supplier_snapshot_age_hours;
  const supplierSnapshotAgeAvailable = supplierSnapshotAgeHours != null;
  const staleSupplierSnapshot =
    supplierSnapshotAgeHours != null &&
    supplierSnapshotAgeHours > SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS;
  const staleMarketplaceSnapshot = priceGuard.reasons.includes("STALE_MARKETPLACE_SNAPSHOT");
  const failClosed =
    !priceGuard.allow || !driftMetricAvailable || !supplierSnapshotAgeAvailable;

  let supplierRefreshJobId: string | null = null;
  let supplierRefreshError: string | null = null;
  let marketplaceRefreshJobId: string | null = null;
  let marketplaceRefreshError: string | null = null;
  if (staleMarketplaceSnapshot) {
    try {
      const candidateLookup = await db.execute<{ supplierSnapshotId: string | null }>(sql`
        SELECT supplier_snapshot_id AS "supplierSnapshotId"
        FROM profitable_candidates
        WHERE id = ${candidateId}
        LIMIT 1
      `);
      const supplierSnapshotId = String(candidateLookup.rows?.[0]?.supplierSnapshotId ?? "").trim();
      const refreshJob = await enqueueMarketplacePriceScan({
        limit: 25,
        productRawId: supplierSnapshotId || undefined,
        platform: "ebay",
      });
      marketplaceRefreshJobId = String(refreshJob.id ?? "");
    } catch (error) {
      marketplaceRefreshError = error instanceof Error ? error.message : String(error);
    }
  }
  if (staleSupplierSnapshot) {
    try {
      const refreshJob = await enqueueSupplierDiscoverRefresh({
        idempotencySuffix: candidateId,
        reason: "supplier-snapshot-age-gt-48h",
      });
      supplierRefreshJobId = String(refreshJob.id ?? "");
    } catch (error) {
      supplierRefreshError = error instanceof Error ? error.message : String(error);
    }
  }

  if (failClosed) {
    const shouldManualReview =
      priceGuard.decision === "MANUAL_REVIEW" ||
      priceGuard.reasons.includes("SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE") ||
      !driftMetricAvailable ||
      !supplierSnapshotAgeAvailable;
    const reasons = [...priceGuard.reasons];
    if (!driftMetricAvailable) reasons.push("SUPPLIER_DRIFT_DATA_REQUIRED");
    if (!supplierSnapshotAgeAvailable) reasons.push("SUPPLIER_SNAPSHOT_AGE_REQUIRED");

    await db.execute(sql`
      UPDATE profitable_candidates
      SET
        decision_status = CASE WHEN ${shouldManualReview} THEN 'MANUAL_REVIEW' ELSE decision_status END,
        listing_eligible = FALSE,
        listing_block_reason = ${`PRICE_GUARD_${priceGuard.decision}: ${reasons.join(", ")}`},
        listing_eligible_ts = NOW()
      WHERE id = ${candidateId}
    `);

    if (priceGuard.reasons.includes("STALE_MARKETPLACE_SNAPSHOT")) {
      await writeAuditLog({
        actorType,
        actorId,
        entityType: "LISTING",
        entityId: input.listingId,
        eventType: "LISTING_BLOCKED_STALE_MARKETPLACE",
        details: {
          listingId: input.listingId,
          candidateId,
          marketplaceKey,
          reasons,
          marketplaceSnapshotAgeHours: priceGuard.metrics.marketplace_snapshot_age_hours,
          maxMarketplaceSnapshotAgeHours: priceGuard.thresholds.maxMarketplaceSnapshotAgeHours,
        },
      });
    }

    if (
      priceGuard.reasons.includes("SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE") ||
      priceGuard.reasons.includes("SUPPLIER_DRIFT_DATA_UNAVAILABLE") ||
      priceGuard.reasons.includes("STALE_SUPPLIER_SNAPSHOT") ||
      !driftMetricAvailable ||
      !supplierSnapshotAgeAvailable
    ) {
      await writeAuditLog({
        actorType,
        actorId,
        entityType: "LISTING",
        entityId: input.listingId,
        eventType: "LISTING_BLOCKED_SUPPLIER_DRIFT",
        details: {
          listingId: input.listingId,
          candidateId,
          marketplaceKey,
          reasons,
          supplierDriftPct: priceGuard.metrics.supplier_price_drift_pct,
          supplierSnapshotAgeHours: priceGuard.metrics.supplier_snapshot_age_hours,
          maxSupplierDriftPct: priceGuard.thresholds.maxSupplierDriftPct,
          maxSupplierSnapshotAgeHours: priceGuard.thresholds.maxSupplierSnapshotAgeHours,
        },
      });
    }

    if (staleSupplierSnapshot) {
      await writeAuditLog({
        actorType,
        actorId,
        entityType: "LISTING",
        entityId: input.listingId,
        eventType: "LISTING_REFRESH_ENQUEUED_FOR_RECOVERY",
        details: {
          listingId: input.listingId,
          candidateId,
          marketplaceKey,
          refreshType: "SUPPLIER_PRODUCT_REFRESH",
          enqueued: supplierRefreshError == null,
          jobId: supplierRefreshJobId,
          error: supplierRefreshError,
        },
      });
    }
    if (staleMarketplaceSnapshot) {
      await writeAuditLog({
        actorType,
        actorId,
        entityType: "LISTING",
        entityId: input.listingId,
        eventType: "LISTING_REFRESH_ENQUEUED_FOR_RECOVERY",
        details: {
          listingId: input.listingId,
          candidateId,
          marketplaceKey,
          refreshType: "MARKETPLACE_PRICE_SCAN",
          enqueued: marketplaceRefreshError == null,
          jobId: marketplaceRefreshJobId,
          error: marketplaceRefreshError,
        },
      });
    }

    return {
      ok: false,
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      reason: staleSupplierSnapshot
        ? supplierRefreshError
          ? `supplier snapshot stale (${supplierSnapshotAgeHours}h > ${SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS}h); refresh enqueue failed: ${supplierRefreshError}`
          : `supplier snapshot stale (${supplierSnapshotAgeHours}h > ${SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS}h); refresh enqueued (${supplierRefreshJobId ?? "job-id-unavailable"})`
        : `price guard blocked publish readiness: ${reasons.join(", ")}`,
    };
  }

  const duplicate = await db.execute(sql`
    SELECT id, status
    FROM listings
    WHERE candidate_id = ${candidateId}
      AND marketplace_key = 'ebay'
      AND status IN ('READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE')
      AND id <> ${input.listingId}
    LIMIT 1
  `);

  if (duplicate.rows.length > 0) {
    return {
      ok: false,
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      reason: "duplicate live-path listing already exists for candidate",
    };
  }

  const updated = await db.execute(sql`
    UPDATE listings
    SET
      status = 'READY_TO_PUBLISH',
      publish_marketplace = 'ebay',
      updated_at = NOW()
    WHERE id = ${input.listingId}
      AND status = 'PREVIEW'
    RETURNING id
  `);

  if (updated.rows.length === 0) {
    return {
      ok: false,
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      reason: "listing could not be promoted from PREVIEW",
    };
  }

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: input.listingId,
    eventType: "LISTING_READY_TO_PUBLISH",
    details: {
      listingId: input.listingId,
      candidateId,
      marketplaceKey: "ebay",
      previousStatus,
      newStatus: "READY_TO_PUBLISH",
    },
  });

  return {
    ok: true,
    listingId: input.listingId,
    candidateId,
    marketplaceKey: "ebay",
    previousStatus,
    newStatus: "READY_TO_PUBLISH",
  };
}
