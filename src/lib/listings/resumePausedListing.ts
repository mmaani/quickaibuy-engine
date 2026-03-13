import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  LISTING_PAUSED_STATUS,
  LISTING_PREVIEW_STATUS,
  canResumePausedListingStatus,
} from "./statuses";

export type ResumePausedListingInput = {
  listingId: string;
  actorId?: string;
  actorType?: "ADMIN" | "WORKER" | "SYSTEM";
};

export type ResumePausedListingResult = {
  ok: boolean;
  listingId: string;
  candidateId?: string;
  marketplaceKey?: string;
  previousStatus?: string;
  newStatus?: "PREVIEW";
  reason?: string;
};

function normalizeActorType(value?: string): "ADMIN" | "WORKER" | "SYSTEM" {
  if (value === "ADMIN" || value === "WORKER") return value;
  return "SYSTEM";
}

export async function resumePausedListing(
  input: ResumePausedListingInput
): Promise<ResumePausedListingResult> {
  const actorId = input.actorId ?? "resumePausedListing";
  const actorType = normalizeActorType(input.actorType);

  const current = await db.execute(sql`
    SELECT id, candidate_id AS "candidateId", marketplace_key AS "marketplaceKey", status
    FROM listings
    WHERE id = ${input.listingId}
    LIMIT 1
  `);

  const row = current.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return { ok: false, listingId: input.listingId, reason: "listing not found" };
  }

  const previousStatus = String(row.status ?? "");
  const candidateId = String(row.candidateId ?? "");
  const marketplaceKey = String(row.marketplaceKey ?? "");

  if (!canResumePausedListingStatus(previousStatus)) {
    return {
      ok: false,
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      reason: "listing must be PAUSED before resume",
    };
  }

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: input.listingId,
    eventType: "LISTING_RESUME_REQUESTED",
    details: {
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      requestedStatus: LISTING_PREVIEW_STATUS,
    },
  });

  const updated = await db.execute(sql`
    UPDATE listings
    SET
      status = ${LISTING_PREVIEW_STATUS},
      updated_at = NOW()
    WHERE id = ${input.listingId}
      AND status = ${LISTING_PAUSED_STATUS}
    RETURNING id
  `);

  if (updated.rows.length === 0) {
    return {
      ok: false,
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      reason: "listing could not be resumed from PAUSED",
    };
  }

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: input.listingId,
    eventType: "LISTING_RESUMED_TO_PREVIEW",
    details: {
      listingId: input.listingId,
      candidateId,
      marketplaceKey,
      previousStatus,
      newStatus: LISTING_PREVIEW_STATUS,
    },
  });

  return {
    ok: true,
    listingId: input.listingId,
    candidateId,
    marketplaceKey,
    previousStatus,
    newStatus: LISTING_PREVIEW_STATUS,
  };
}
