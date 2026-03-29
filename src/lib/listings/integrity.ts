import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

type ActorType = "ADMIN" | "SYSTEM" | "WORKER";

type IntegritySchemaSupport = {
  listingsSupplierKey: boolean;
  listingsSupplierProductId: boolean;
  publishStartedTs: boolean;
};

export type ListingIntegritySummary = {
  orphanReadyToPublishCount: number;
  detachedPreviewCount: number;
  orphanActiveCount: number;
  stalePublishInProgressCount: number;
  brokenLineageCount: number;
};

export type ListingIntegrityRow = {
  listingId: string;
  candidateId: string | null;
  status: string;
  marketplaceKey: string;
  supplierKey: string | null;
  supplierProductId: string | null;
  listingSupplierKey: string | null;
  listingSupplierProductId: string | null;
  updatedAt: string | null;
  publishStartedTs: string | null;
};

export type ListingIntegrityHealResult = {
  before: ListingIntegritySummary;
  after: ListingIntegritySummary;
  orphanReadyToPublishClosed: string[];
  detachedPreviewsArchived: string[];
  orphanActivePaused: string[];
  stalePublishInProgressFailed: string[];
  brokenLineageContained: string[];
};

let schemaSupportPromise: Promise<IntegritySchemaSupport> | null = null;

function normalizeActorType(value?: string): ActorType {
  if (value === "ADMIN" || value === "WORKER") return value;
  return "SYSTEM";
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS "exists"
  `);
  return Boolean(result.rows?.[0]?.exists);
}

async function getIntegritySchemaSupport(): Promise<IntegritySchemaSupport> {
  if (!schemaSupportPromise) {
    schemaSupportPromise = (async () => {
      const [listingsSupplierKey, listingsSupplierProductId, publishStartedTs] = await Promise.all([
        hasColumn("listings", "supplier_key"),
        hasColumn("listings", "supplier_product_id"),
        hasColumn("listings", "publish_started_ts"),
      ]);
      return {
        listingsSupplierKey,
        listingsSupplierProductId,
        publishStartedTs,
      };
    })();
  }
  return schemaSupportPromise;
}

export async function getListingIntegritySummary(): Promise<ListingIntegritySummary> {
  const schema = await getIntegritySchemaSupport();
  const stalePublishExpr = schema.publishStartedTs
    ? sql`count(*) FILTER (
        WHERE l.status = 'PUBLISH_IN_PROGRESS'
          AND l.publish_started_ts < NOW() - INTERVAL '30 minutes'
      )::int`
    : sql`0::int`;
  const brokenLineageExpr =
    schema.listingsSupplierKey || schema.listingsSupplierProductId
      ? sql`count(*) FILTER (
          WHERE pc.id IS NOT NULL
            AND lower(l.marketplace_key) = lower(pc.marketplace_key)
            AND (
              ${
                schema.listingsSupplierKey
                  ? sql`(l.supplier_key IS NOT NULL AND lower(l.supplier_key) <> lower(pc.supplier_key))`
                  : sql`FALSE`
              }
              OR ${
                schema.listingsSupplierProductId
                  ? sql`(l.supplier_product_id IS NOT NULL AND l.supplier_product_id <> pc.supplier_product_id)`
                  : sql`FALSE`
              }
            )
        )::int`
      : sql`0::int`;

  const result = await db.execute<{
    orphanReadyToPublishCount: number;
    detachedPreviewCount: number;
    orphanActiveCount: number;
    stalePublishInProgressCount: number;
    brokenLineageCount: number;
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
      ${stalePublishExpr} AS "stalePublishInProgressCount",
      ${brokenLineageExpr} AS "brokenLineageCount"
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
      brokenLineageCount: 0,
    }
  );
}

async function listIntegrityRows(whereClause: ReturnType<typeof sql>): Promise<ListingIntegrityRow[]> {
  const schema = await getIntegritySchemaSupport();
  const result = await db.execute<ListingIntegrityRow>(sql`
    SELECT
      l.id::text AS "listingId",
      l.candidate_id::text AS "candidateId",
      l.status,
      l.marketplace_key AS "marketplaceKey",
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      ${
        schema.listingsSupplierKey
          ? sql`l.supplier_key`
          : sql`NULL::text`
      } AS "listingSupplierKey",
      ${
        schema.listingsSupplierProductId
          ? sql`l.supplier_product_id`
          : sql`NULL::text`
      } AS "listingSupplierProductId",
      l.updated_at::text AS "updatedAt",
      ${schema.publishStartedTs ? sql`l.publish_started_ts::text` : sql`NULL::text`} AS "publishStartedTs"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE ${whereClause}
    ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
  `);
  return result.rows ?? [];
}

export async function listOrphanReadyToPublishListings(): Promise<ListingIntegrityRow[]> {
  return listIntegrityRows(sql`l.status = 'READY_TO_PUBLISH' AND pc.id IS NULL`);
}

export async function listDetachedPreviewListings(): Promise<ListingIntegrityRow[]> {
  return listIntegrityRows(sql`l.status = 'PREVIEW' AND pc.id IS NULL`);
}

export async function listOrphanActiveListings(): Promise<ListingIntegrityRow[]> {
  return listIntegrityRows(sql`l.status = 'ACTIVE' AND pc.id IS NULL`);
}

export async function listStalePublishInProgressListings(): Promise<ListingIntegrityRow[]> {
  const schema = await getIntegritySchemaSupport();
  if (!schema.publishStartedTs) return [];
  return listIntegrityRows(
    sql`l.status = 'PUBLISH_IN_PROGRESS' AND l.publish_started_ts < NOW() - INTERVAL '30 minutes'`
  );
}

export async function listBrokenLineageListings(): Promise<ListingIntegrityRow[]> {
  const schema = await getIntegritySchemaSupport();
  if (!schema.listingsSupplierKey && !schema.listingsSupplierProductId) return [];
  return listIntegrityRows(sql`
    pc.id IS NOT NULL
    AND lower(l.marketplace_key) = lower(pc.marketplace_key)
    AND (
      ${
        schema.listingsSupplierKey
          ? sql`(l.supplier_key IS NOT NULL AND lower(l.supplier_key) <> lower(pc.supplier_key))`
          : sql`FALSE`
      }
      OR ${
        schema.listingsSupplierProductId
          ? sql`(l.supplier_product_id IS NOT NULL AND l.supplier_product_id <> pc.supplier_product_id)`
          : sql`FALSE`
      }
    )
  `);
}

export async function containBrokenLineageListing(input: {
  listingId: string;
  actorId?: string;
  actorType?: ActorType;
}) {
  const listingId = String(input.listingId ?? "").trim();
  const actorId = input.actorId ?? "containBrokenLineageListing";
  const actorType = normalizeActorType(input.actorType);
  if (!listingId) throw new Error("listingId required");

  const current = await db.execute<{ status: string }>(sql`
    SELECT status
    FROM listings
    WHERE id = ${listingId}
    LIMIT 1
  `);
  const status = String(current.rows?.[0]?.status ?? "").trim();
  if (!status) return false;

  const pausedStatuses = new Set(["ACTIVE"]);
  const targetStatus = pausedStatuses.has(status) ? "PAUSED" : "PUBLISH_FAILED";

  const updated = await db.execute<{ id: string }>(sql`
    UPDATE listings
    SET
      status = ${targetStatus},
      last_publish_error = 'Listing blocked: candidate/listing supplier lineage mismatch; manual investigation required',
      response = COALESCE(response, '{}'::jsonb) || jsonb_build_object(
        'recoveryState', 'BLOCKED_BROKEN_LINEAGE',
        'publishBlocked', true,
        'requiresManualRecovery', true,
        'blockedAt', NOW(),
        'note', 'Listing supplier lineage diverged from profitable candidate lineage and was fail-closed.'
      ),
      updated_at = NOW()
    WHERE id = ${listingId}
    RETURNING id
  `);
  if (!updated.rows?.length) return false;

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_CONTAINED_BROKEN_LINEAGE",
    details: {
      listingId,
      previousStatus: status,
      newStatus: targetStatus,
      reason: "candidate/listing supplier lineage mismatch",
      manualRecoveryRequired: true,
    },
  });
  return true;
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
  const responsePatch = {
    recoveryState: "BLOCKED_ORPHANED_PREVIEW",
    publishBlocked: true,
    requiresManualRecovery: true,
    blockedAt: new Date().toISOString(),
    note: reason,
  };

  const updated = await db.execute<{
    id: string;
    candidateId: string | null;
    status: string;
    updatedAt: string;
  }>(sql`
    UPDATE listings
    SET
      status = 'PUBLISH_FAILED',
      last_publish_error = COALESCE(NULLIF(last_publish_error, ''), ${reason}),
      response = COALESCE(response, '{}'::jsonb) || ${JSON.stringify(responsePatch)}::jsonb,
      updated_at = NOW()
    WHERE id = ${listingId}
      AND status = 'PREVIEW'
      AND NOT EXISTS (
        SELECT 1
        FROM profitable_candidates pc
        WHERE pc.id = listings.candidate_id
      )
    RETURNING
      id,
      candidate_id AS "candidateId",
      status,
      updated_at AS "updatedAt"
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

export async function pauseOrphanActiveListing(input: {
  listingId: string;
  actorId?: string;
  actorType?: ActorType;
}) {
  const listingId = String(input.listingId ?? "").trim();
  const actorId = input.actorId ?? "pauseOrphanActiveListing";
  const actorType = normalizeActorType(input.actorType);
  if (!listingId) throw new Error("listingId required");

  const updated = await db.execute<{ id: string }>(sql`
    UPDATE listings
    SET
      status = 'PAUSED',
      last_publish_error = 'Listing paused: orphan ACTIVE listing lost profitable_candidates lineage; manual investigation required',
      response = COALESCE(response, '{}'::jsonb) || jsonb_build_object(
        'recoveryState', 'BLOCKED_ORPHANED_ACTIVE',
        'publishBlocked', true,
        'requiresManualRecovery', true,
        'blockedAt', NOW(),
        'note', 'ACTIVE listing lost profitable_candidates lineage and was paused fail-closed.'
      ),
      updated_at = NOW()
    WHERE id = ${listingId}
      AND status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1
        FROM profitable_candidates pc
        WHERE pc.id = listings.candidate_id
      )
    RETURNING id
  `);
  if (!updated.rows?.length) return false;

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_PAUSED_ORPHANED_ACTIVE",
    details: {
      listingId,
      previousStatus: "ACTIVE",
      newStatus: "PAUSED",
      reason: "candidate lineage missing for active listing",
      nextAction: "manual investigation required",
    },
  });
  return true;
}

export async function failCloseStalePublishInProgressListing(input: {
  listingId: string;
  actorId?: string;
  actorType?: ActorType;
}) {
  const listingId = String(input.listingId ?? "").trim();
  const actorId = input.actorId ?? "failCloseStalePublishInProgressListing";
  const actorType = normalizeActorType(input.actorType);
  if (!listingId) throw new Error("listingId required");

  const updated = await db.execute<{ id: string }>(sql`
    UPDATE listings
    SET
      status = 'PUBLISH_FAILED',
      last_publish_error = COALESCE(NULLIF(last_publish_error, ''), 'Publish blocked: stale publish attempt timed out; manual review required'),
      response = COALESCE(response, '{}'::jsonb) || jsonb_build_object(
        'recoveryState', 'BLOCKED_STALE_PUBLISH_IN_PROGRESS',
        'publishBlocked', true,
        'requiresManualRecovery', true,
        'blockedAt', NOW(),
        'note', 'Listing remained PUBLISH_IN_PROGRESS longer than policy threshold and was fail-closed.'
      ),
      publish_finished_ts = NOW(),
      updated_at = NOW()
    WHERE id = ${listingId}
      AND status = 'PUBLISH_IN_PROGRESS'
      AND publish_started_ts < NOW() - INTERVAL '30 minutes'
    RETURNING id
  `);
  if (!updated.rows?.length) return false;

  await writeAuditLog({
    actorType,
    actorId,
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_FAIL_CLOSED_STALE_PUBLISH_IN_PROGRESS",
    details: {
      listingId,
      previousStatus: "PUBLISH_IN_PROGRESS",
      newStatus: "PUBLISH_FAILED",
      reason: "publish path exceeded staleness threshold",
    },
  });
  return true;
}

export async function healListingIntegrity(input?: {
  actorId?: string;
  actorType?: ActorType;
  limitPerClass?: number;
}): Promise<ListingIntegrityHealResult> {
  const actorId = input?.actorId ?? "healListingIntegrity";
  const actorType = normalizeActorType(input?.actorType);
  const limitPerClass = Math.max(1, Math.min(Number(input?.limitPerClass ?? 25), 100));
  const before = await getListingIntegritySummary();

  const [orphanReady, detachedPreviews, orphanActive, stalePublish] = await Promise.all([
    listOrphanReadyToPublishListings(),
    listDetachedPreviewListings(),
    listOrphanActiveListings(),
    listStalePublishInProgressListings(),
  ]);
  const brokenLineage = await listBrokenLineageListings();

  const orphanReadyToPublishClosed: string[] = [];
  const detachedPreviewsArchived: string[] = [];
  const orphanActivePaused: string[] = [];
  const stalePublishInProgressFailed: string[] = [];
  const brokenLineageContained: string[] = [];

  for (const row of orphanReady.slice(0, limitPerClass)) {
    await failCloseOrphanedReadyToPublishListing({
      listingId: row.listingId,
      actorId,
      actorType,
    });
    orphanReadyToPublishClosed.push(row.listingId);
  }

  for (const row of detachedPreviews.slice(0, limitPerClass)) {
    const archived = await archiveDetachedPreviewListing({
      listingId: row.listingId,
      reason: "Detached PREVIEW row removed from active review path by autonomous integrity healing.",
      actorId,
      actorType,
    });
    if (archived) detachedPreviewsArchived.push(row.listingId);
  }

  for (const row of orphanActive.slice(0, limitPerClass)) {
    const paused = await pauseOrphanActiveListing({
      listingId: row.listingId,
      actorId,
      actorType,
    });
    if (paused) orphanActivePaused.push(row.listingId);
  }

  for (const row of stalePublish.slice(0, limitPerClass)) {
    const failed = await failCloseStalePublishInProgressListing({
      listingId: row.listingId,
      actorId,
      actorType,
    });
    if (failed) stalePublishInProgressFailed.push(row.listingId);
  }

  for (const row of brokenLineage.slice(0, limitPerClass)) {
    const contained = await containBrokenLineageListing({
      listingId: row.listingId,
      actorId,
      actorType,
    });
    if (contained) brokenLineageContained.push(row.listingId);
  }

  const after = await getListingIntegritySummary();

  return {
    before,
    after,
    orphanReadyToPublishClosed,
    detachedPreviewsArchived,
    orphanActivePaused,
    stalePublishInProgressFailed,
    brokenLineageContained,
  };
}
