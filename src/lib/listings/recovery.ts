import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { validateProfitSafety } from "@/lib/profit/priceGuard";
import { enqueueMarketplacePriceScan } from "@/lib/jobs/enqueueMarketplacePriceScan";
import { enqueueSupplierDiscoverRefresh } from "@/lib/jobs/enqueueSupplierDiscover";
import { isPausedListingStatus } from "./statuses";

export type ReevaluateListingRecoveryInput = {
  listingId: string;
  actorId?: string;
  actorType?: "ADMIN" | "WORKER" | "SYSTEM";
};

export type ReevaluateListingRecoveryResult = {
  ok: boolean;
  listingId: string;
  candidateId?: string;
  decision?: "READY_FOR_REPROMOTION" | "REMAIN_BLOCKED";
  recoveryState?:
    | "PAUSED_REQUIRES_RESUME"
    | "BLOCKED_STALE_MARKETPLACE"
    | "BLOCKED_STALE_SUPPLIER"
    | "BLOCKED_SUPPLIER_DRIFT"
    | "BLOCKED_OTHER_FAIL_CLOSED"
    | "READY_FOR_REPROMOTION";
  nextAction?: string;
  reasons?: string[];
  reason?: string;
};

function normalizeActorType(value?: string): "ADMIN" | "WORKER" | "SYSTEM" {
  if (value === "ADMIN" || value === "WORKER") return value;
  return "SYSTEM";
}

export async function reevaluateListingForRecovery(
  input: ReevaluateListingRecoveryInput
): Promise<ReevaluateListingRecoveryResult> {
  const actorId = input.actorId ?? "reevaluateListingForRecovery";
  const actorType = normalizeActorType(input.actorType);
  const listingId = String(input.listingId ?? "").trim();
  if (!listingId) return { ok: false, listingId, reason: "listingId required" };

  const current = await db.execute<{
    listingId: string;
    candidateId: string;
    marketplaceKey: string;
    status: string;
  }>(sql`
    SELECT
      l.id AS "listingId",
      l.candidate_id AS "candidateId",
      l.marketplace_key AS "marketplaceKey",
      l.status
    FROM listings l
    WHERE l.id = ${listingId}
    LIMIT 1
  `);
  const row = current.rows?.[0];
  if (!row) return { ok: false, listingId, reason: "listing not found" };

  const candidateId = String(row.candidateId ?? "");
  const marketplaceKey = String(row.marketplaceKey ?? "");
  const listingStatus = String(row.status ?? "");
  if (marketplaceKey !== "ebay") {
    return {
      ok: false,
      listingId,
      candidateId,
      reason: "re-evaluation is eBay-only in v1",
    };
  }

  if (isPausedListingStatus(listingStatus)) {
    await writeAuditLog({
      actorType,
      actorId,
      entityType: "LISTING",
      entityId: listingId,
      eventType: "LISTING_REEVALUATED_PAUSED_REQUIRES_RESUME",
      details: {
        listingId,
        candidateId,
        marketplaceKey,
        listingStatus,
        nextAction: "Operator must explicitly resume listing to PREVIEW before promotion.",
      },
    });

    return {
      ok: false,
      listingId,
      candidateId,
      decision: "REMAIN_BLOCKED",
      recoveryState: "PAUSED_REQUIRES_RESUME",
      nextAction: "Operator must explicitly resume listing to PREVIEW before promotion.",
      reasons: ["PAUSED_REQUIRES_RESUME"],
      reason: "listing is paused; explicit operator resume is required",
    };
  }

  const priceGuard = await validateProfitSafety({
    candidateId,
    listingId,
    mode: "publish",
  });

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_REEVALUATED_AFTER_REFRESH",
    details: {
      listingId,
      candidateId,
      marketplaceKey,
      priceGuard,
    },
  });

  if (!priceGuard.allow) {
    const staleMarketplace = priceGuard.reasons.includes("STALE_MARKETPLACE_SNAPSHOT");
    const staleSupplier = priceGuard.reasons.includes("STALE_SUPPLIER_SNAPSHOT");
    const supplierDrift =
      priceGuard.reasons.includes("SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE") ||
      priceGuard.reasons.includes("SUPPLIER_DRIFT_DATA_UNAVAILABLE") ||
      priceGuard.reasons.includes("SUPPLIER_DRIFT_DATA_REQUIRED");
    let marketJobId: string | null = null;
    let supplierJobId: string | null = null;

    if (staleMarketplace) {
      const candidateLookup = await db.execute<{ supplierSnapshotId: string | null }>(sql`
        SELECT supplier_snapshot_id AS "supplierSnapshotId"
        FROM profitable_candidates
        WHERE id = ${candidateId}
        LIMIT 1
      `);
      const supplierSnapshotId = String(candidateLookup.rows?.[0]?.supplierSnapshotId ?? "").trim();
      if (supplierSnapshotId) {
        const job = await enqueueMarketplacePriceScan({
          limit: 25,
          productRawId: supplierSnapshotId,
          platform: "ebay",
        });
        marketJobId = String(job.id ?? "");
      }
    }

    if (staleSupplier) {
      const job = await enqueueSupplierDiscoverRefresh({
        idempotencySuffix: candidateId,
        reason: "re-evaluation-still-stale-supplier",
      });
      supplierJobId = String(job.id ?? "");
    }

    await db.execute(sql`
      UPDATE profitable_candidates
      SET
        listing_eligible = FALSE,
        listing_block_reason = ${`PRICE_GUARD_${priceGuard.decision}: ${priceGuard.reasons.join(", ")}`},
        listing_eligible_ts = NOW()
      WHERE id = ${candidateId}
    `);

    await writeAuditLog({
      actorType,
      actorId,
      entityType: "LISTING",
      entityId: listingId,
      eventType: "LISTING_REFRESH_ENQUEUED_FOR_RECOVERY",
      details: {
        listingId,
        candidateId,
        marketplaceKey,
        refreshType: staleMarketplace ? "MARKETPLACE_PRICE_SCAN" : staleSupplier ? "SUPPLIER_PRODUCT_REFRESH" : "NONE",
        marketplaceRefreshJobId: marketJobId,
        supplierRefreshJobId: supplierJobId,
        reasons: priceGuard.reasons,
      },
    });

    return {
      ok: false,
      listingId,
      candidateId,
      decision: "REMAIN_BLOCKED",
      recoveryState: staleMarketplace
        ? "BLOCKED_STALE_MARKETPLACE"
        : staleSupplier
          ? "BLOCKED_STALE_SUPPLIER"
          : supplierDrift
            ? "BLOCKED_SUPPLIER_DRIFT"
            : "BLOCKED_OTHER_FAIL_CLOSED",
      nextAction: staleMarketplace || staleSupplier
        ? "Wait for refresh jobs, then run explicit re-evaluation again."
        : "Review block reasons and run explicit re-evaluation again.",
      reasons: priceGuard.reasons,
      reason: `still blocked: ${priceGuard.reasons.join(", ")}`,
    };
  }

  await db.execute(sql`
    UPDATE profitable_candidates
    SET
      decision_status = 'APPROVED',
      listing_eligible = TRUE,
      listing_block_reason = NULL,
      listing_eligible_ts = NOW()
    WHERE id = ${candidateId}
  `);

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_REPROMOTION_READY",
    details: {
      listingId,
      candidateId,
      marketplaceKey,
      decision: "READY_FOR_REPROMOTION",
      priceGuard,
    },
  });

  return {
    ok: true,
    listingId,
    candidateId,
    decision: "READY_FOR_REPROMOTION",
    recoveryState: "READY_FOR_REPROMOTION",
    nextAction: "Operator can explicitly promote back to READY_TO_PUBLISH.",
    reasons: [],
  };
}
