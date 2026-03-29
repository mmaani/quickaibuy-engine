import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

type ActorType = "ADMIN" | "SYSTEM" | "WORKER";

export type ListingIntegritySummary = {
  orphanReadyToPublishCount: number;
  detachedPreviewCount: number;
  orphanActiveCount: number;
  stalePublishInProgressCount: number;
};

function normalizeActorType(value?: string): ActorType {
  if (value === "ADMIN" || value === "WORKER") return value;
  return "SYSTEM";
}

export async function getListingIntegritySummary(): Promise<ListingIntegritySummary> {
  const result = await db.execute<{
    orphanReadyToPublishCount: number;
    detachedPreviewCount: number;
    orphanActiveCount: number;
    stalePublishInProgressCount: number;
  }>(sql`
    SELECT
      count(*) FILTER (
        WHERE l.status = 'READY_TO_PUBLISH'
          AND pc.id IS NULL
      )::int AS "orphanReadyToPublishCount",
      count(*) FILTER (
        WHERE l.status = 'PREVIEW'
          AND pc.id IS NULL
      )::int AS "detachedPreviewCount",
      count(*) FILTER (
        WHERE l.status = 'ACTIVE'
          AND pc.id IS NULL
      )::int AS "orphanActiveCount",
      count(*) FILTER (
        WHERE l.status = 'PUBLISH_IN_PROGRESS'
          AND l.publish_started_ts < NOW() - INTERVAL '30 minutes'
      )::int AS "stalePublishInProgressCount"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
  `);

  return (
    result.rows?.[0] ?? {
      orphanReadyToPublishCount: 0,
      detachedPreviewCount: 0,
      orphanActiveCount: 0,
      stalePublishInProgressCount: 0,
    }
  );
}

export async function failCloseOrphanedReadyToPublishListing(input: {
  listingId: string;
  actorId?: string;
  actorType?: ActorType;
}) {
  const listingId = String(input.listingId ?? "").trim();
  const actorId = input.actorId ?? "failCloseOrphanedReadyToPublishListing";
  const actorType = normalizeActorType(input.actorType);
  if (!listingId) {
    throw new Error("listingId required");
  }

  const current = await db.execute<{
    id: string;
    status: string;
    candidateId: string | null;
    candidateExists: string | null;
  }>(sql`
    SELECT
      l.id,
      l.status,
      l.candidate_id AS "candidateId",
      pc.id AS "candidateExists"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.id = ${listingId}
    LIMIT 1
  `);

  const row = current.rows?.[0] ?? null;
  if (!row) throw new Error("Listing not found.");
  if (String(row.status ?? "") !== "READY_TO_PUBLISH") {
    throw new Error(`Blocked: listing must be READY_TO_PUBLISH. Current status: ${row.status}`);
  }
  if (row.candidateExists) {
    throw new Error("Blocked: candidate still exists. This repair only applies to orphaned listings.");
  }

  const responsePatch = {
    recoveryState: "BLOCKED_ORPHANED_CANDIDATE",
    publishBlocked: true,
    requiresManualRecovery: true,
    blockedAt: new Date().toISOString(),
    note: "Candidate row missing after refresh attempt; moved fail-closed out of READY_TO_PUBLISH.",
  };

  await db.execute(sql`
    UPDATE listings
    SET
      status = 'PUBLISH_FAILED',
      last_publish_error = 'Publish blocked: candidate missing after refresh; manual recovery required',
      response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify(responsePatch)}::jsonb,
      updated_at = NOW()
    WHERE id = ${listingId}
  `);

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_FAIL_CLOSED_ORPHANED_CANDIDATE",
    details: {
      listingId,
      previousStatus: "READY_TO_PUBLISH",
      newStatus: "PUBLISH_FAILED",
      reason: "candidate missing after refresh attempt",
      nextAction: "manual recovery required before any future promotion",
    },
  });
}

export async function archiveDetachedPreviewListing(input: {
  listingId: string;
  reason: string;
  actorId?: string;
  actorType?: ActorType;
}) {
  const listingId = String(input.listingId ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  const actorId = input.actorId ?? "archiveDetachedPreviewListing";
  const actorType = normalizeActorType(input.actorType);
  if (!listingId || !reason) throw new Error("listingId and reason are required");

  const updated = await db.execute<{
    id: string;
    candidateId: string | null;
    status: string;
    updatedAt: string;
  }>(sql`
    UPDATE listings l
    SET
      status = 'PUBLISH_FAILED',
      last_publish_error = COALESCE(NULLIF(l.last_publish_error, ''), '') ||
        CASE
          WHEN COALESCE(NULLIF(l.last_publish_error, ''), '') = '' THEN ${reason}
          ELSE ' | ' || ${reason}
        END,
      response = COALESCE(l.response, '{}'::jsonb) || jsonb_build_object(
        'recoveryState', 'BLOCKED_ORPHANED_PREVIEW',
        'publishBlocked', true,
        'requiresManualRecovery', true,
        'blockedAt', NOW(),
        'note', ${reason}
      ),
      updated_at = NOW()
    WHERE l.id = ${listingId}
      AND l.status = 'PREVIEW'
      AND NOT EXISTS (
        SELECT 1
        FROM profitable_candidates pc
        WHERE pc.id = l.candidate_id
      )
    RETURNING
      l.id,
      l.candidate_id AS "candidateId",
      l.status,
      l.updated_at AS "updatedAt"
  `);

  const row = updated.rows?.[0] ?? null;
  if (!row) return null;

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_DETACHED_PREVIEW_ARCHIVED",
    details: {
      listingId,
      reason,
      previousStatus: "PREVIEW",
      newStatus: "PUBLISH_FAILED",
    },
  });

  return row;
}
