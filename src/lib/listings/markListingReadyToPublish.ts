import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

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
