import { pool } from "@/lib/db";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { LISTING_STATUSES } from "@/lib/listings/statuses";

export const LISTINGS_ROUTE = "/admin/listings";

type QueryRow = Record<string, unknown>;

type ListingQueueRow = {
  id: string;
  supplier_key: string;
  supplier_product_id: string;
  marketplace_key: string;
  marketplace_listing_id: string;
  estimated_profit: number | string | null;
  margin_pct: number | string | null;
  roi_pct: number | string | null;
  decision_status: string;
  listing_eligible: boolean;
  listing_block_reason: string | null;
  approved_ts: string | Date | null;
  approved_by: string | null;
  listing_id: string | null;
  listing_status: string | null;
  listing_title: string | null;
  listing_price: number | string | null;
  listing_quantity: number | string | null;
  listing_payload: unknown;
  listing_response: unknown;
  listing_created_at: string | Date | null;
  listing_updated_at: string | Date | null;
  duplicate_detected: boolean;
  duplicate_reason: string | null;
  duplicate_listing_ids: string[] | null;
};

export type ListingsQueueFilters = {
  supplier: string;
  marketplace: string;
  listingEligible: string;
  previewPrepared: string;
  listingStatus: string;
  minProfit: string;
  minMargin: string;
  minRoi: string;
  candidateId: string;
};

export type QueueListItem = {
  id: string;
  supplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  estimatedProfit: number | null;
  marginPct: number | null;
  roiPct: number | null;
  decisionStatus: string;
  listingEligible: boolean;
  listingEligibilityReasons: string[];
  previewStatus: "NOT_PREPARED" | "PREPARED" | "INCOMPLETE";
  previewMissingFields: string[];
  listingId: string | null;
  listingStatus: string | null;
  listingTitle: string | null;
  listingPrice: number | null;
  listingQuantity: number | null;
  listingPayload: Record<string, unknown> | null;
  listingResponse: Record<string, unknown> | null;
  listingCreatedAt: string | null;
  listingUpdatedAt: string | null;
  approvedTs: string | null;
  approvedBy: string | null;
  duplicateDetected: boolean;
  duplicateReason: string | null;
  duplicateListingIds: string[];
  recoveryState: "NONE" | "BLOCKED_STALE_OR_DRIFT" | "READY_FOR_REEVALUATION" | "READY_FOR_REPROMOTION";
  recoveryNextAction: string;
};

export type QueueOverview = {
  approvedCandidatesCount: number;
  listingEligibleCount: number;
  previewPreparedCount: number;
  readyToPublishCount: number;
  publishFailedCount: number;
};

export type ListingsQueueDetail = {
  item: QueueListItem;
  recentAuditEvents: Array<{
    id: string;
    eventTs: string;
    actorType: string;
    actorId: string | null;
    entityType: string;
    entityId: string;
    eventType: string;
    details: unknown;
  }>;
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIsoString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function computeListingEligibilityReasons(row: ListingQueueRow): string[] {
  const reasons: string[] = [];
  if (row.decision_status !== "APPROVED") reasons.push("decision_status is not APPROVED");
  if (!row.listing_eligible) {
    reasons.push(row.listing_block_reason?.trim() || "listing_eligible is false");
  }
  return reasons;
}

function evaluatePreviewReadiness(row: ListingQueueRow): {
  previewStatus: "NOT_PREPARED" | "PREPARED" | "INCOMPLETE";
  previewMissingFields: string[];
} {
  if (!row.listing_id) {
    return {
      previewStatus: "NOT_PREPARED",
      previewMissingFields: ["No listing preview exists"],
    };
  }

  const missing: string[] = [];
  const title = row.listing_title?.trim() ?? "";
  const price = toNumber(row.listing_price);
  const quantity = toNumber(row.listing_quantity);
  const payload = asObject(row.listing_payload);

  if (!title) missing.push("title");
  if (!(price && price > 0)) missing.push("price");
  if (!(quantity && quantity > 0)) missing.push("quantity");
  if (!payload) {
    missing.push("payload");
  } else if (normalizeMarketplaceKey(row.marketplace_key) === "ebay") {
    const shipFromCountry = String(payload.shipFromCountry ?? "").trim();
    if (!shipFromCountry) {
      missing.push("payload.shipFromCountry");
    } else if (!/^[A-Z]{2}$/.test(shipFromCountry)) {
      missing.push("payload.shipFromCountry (ISO-3166 alpha-2 required)");
    }
  }

  return {
    previewStatus: missing.length ? "INCOMPLETE" : "PREPARED",
    previewMissingFields: missing,
  };
}

function mapQueueRow(row: ListingQueueRow): QueueListItem {
  const readiness = evaluatePreviewReadiness(row);
  const blockReason = String(row.listing_block_reason ?? "").toUpperCase();
  const hasRecoveryBlock =
    blockReason.includes("STALE_MARKETPLACE") ||
    blockReason.includes("STALE_SUPPLIER") ||
    blockReason.includes("SUPPLIER_PRICE_DRIFT") ||
    blockReason.includes("SUPPLIER_DRIFT");
  const decisionStatus = String(row.decision_status ?? "").toUpperCase();
  const listingStatus = String(row.listing_status ?? "").toUpperCase();
  const recoveryState: QueueListItem["recoveryState"] = hasRecoveryBlock
    ? "BLOCKED_STALE_OR_DRIFT"
    : decisionStatus === "MANUAL_REVIEW" && !row.listing_eligible
      ? "READY_FOR_REEVALUATION"
      : decisionStatus === "APPROVED" && row.listing_eligible && listingStatus === LISTING_STATUSES.READY_TO_PUBLISH
        ? "READY_FOR_REPROMOTION"
        : "NONE";
  const recoveryNextAction =
    recoveryState === "BLOCKED_STALE_OR_DRIFT"
      ? "Run re-evaluation after refresh completes."
      : recoveryState === "READY_FOR_REEVALUATION"
        ? "Run explicit re-evaluation."
        : recoveryState === "READY_FOR_REPROMOTION"
          ? "Execute guarded publish worker."
          : "No recovery action required.";

  return {
    id: row.id,
    supplierKey: row.supplier_key,
    supplierProductId: row.supplier_product_id,
    marketplaceKey: normalizeMarketplaceKey(row.marketplace_key),
    marketplaceListingId: row.marketplace_listing_id,
    estimatedProfit: toNumber(row.estimated_profit),
    marginPct: toNumber(row.margin_pct),
    roiPct: toNumber(row.roi_pct),
    decisionStatus: row.decision_status,
    listingEligible: Boolean(row.listing_eligible),
    listingEligibilityReasons: computeListingEligibilityReasons(row),
    previewStatus: readiness.previewStatus,
    previewMissingFields: readiness.previewMissingFields,
    listingId: row.listing_id,
    listingStatus: row.listing_status,
    listingTitle: row.listing_title,
    listingPrice: toNumber(row.listing_price),
    listingQuantity: toNumber(row.listing_quantity),
    listingPayload: asObject(row.listing_payload),
    listingResponse: asObject(row.listing_response),
    listingCreatedAt: toIsoString(row.listing_created_at),
    listingUpdatedAt: toIsoString(row.listing_updated_at),
    approvedTs: toIsoString(row.approved_ts),
    approvedBy: row.approved_by,
    duplicateDetected: Boolean(row.duplicate_detected),
    duplicateReason: row.duplicate_reason ?? null,
    duplicateListingIds: row.duplicate_listing_ids ?? [],
    recoveryState,
    recoveryNextAction,
  };
}

export function getListingsQueueFiltersFromSearchParams(
  searchParams?: Record<string, string | string[] | undefined>
): ListingsQueueFilters {
  return {
    supplier: String(searchParams?.supplier ?? "").trim(),
    marketplace: String(searchParams?.marketplace ?? "").trim(),
    listingEligible: String(searchParams?.listingEligible ?? "").trim(),
    previewPrepared: String(searchParams?.previewPrepared ?? "").trim(),
    listingStatus: String(searchParams?.listingStatus ?? "").trim(),
    minProfit: String(searchParams?.minProfit ?? "").trim(),
    minMargin: String(searchParams?.minMargin ?? "").trim(),
    minRoi: String(searchParams?.minRoi ?? "").trim(),
    candidateId: String(searchParams?.candidateId ?? "").trim(),
  };
}

export async function getListingsQueueFilterOptions(): Promise<{
  suppliers: string[];
  marketplaces: string[];
  listingStatuses: string[];
}> {
  const [suppliersResult, marketplacesResult, statusesResult] = await Promise.all([
    pool.query<{ supplier_key: string }>(
      `
      SELECT DISTINCT supplier_key
      FROM profitable_candidates
      WHERE supplier_key IS NOT NULL AND supplier_key <> ''
      ORDER BY supplier_key ASC
    `
    ),
    pool.query<{ marketplace_key: string }>(
      `
      SELECT DISTINCT
        CASE
          WHEN LOWER(marketplace_key) LIKE 'amazon%' THEN 'amazon'
          WHEN LOWER(marketplace_key) LIKE 'ebay%' THEN 'ebay'
          ELSE LOWER(marketplace_key)
        END AS marketplace_key
      FROM profitable_candidates
      WHERE marketplace_key IS NOT NULL AND marketplace_key <> ''
      ORDER BY marketplace_key ASC
    `
    ),
    pool.query<{ status: string }>(
      `
      SELECT DISTINCT status
      FROM listings
      ORDER BY status ASC
    `
    ),
  ]);

  return {
    suppliers: suppliersResult.rows.map((r) => r.supplier_key),
    marketplaces: marketplacesResult.rows.map((r) => r.marketplace_key),
    listingStatuses: statusesResult.rows.map((r) => r.status),
  };
}

export async function getListingsQueueOverview(): Promise<QueueOverview> {
  const result = await pool.query<QueryRow>(`
    SELECT
      count(*) FILTER (WHERE pc.decision_status = 'APPROVED')::int AS approved_candidates_count,
      count(*) FILTER (WHERE pc.decision_status = 'APPROVED' AND pc.listing_eligible = true)::int AS listing_eligible_count,
      count(*) FILTER (WHERE pc.decision_status = 'APPROVED' AND l.id IS NOT NULL)::int AS preview_prepared_count,
      count(*) FILTER (WHERE pc.decision_status = 'APPROVED' AND l.status = '${LISTING_STATUSES.READY_TO_PUBLISH}')::int AS ready_to_publish_count,
      count(*) FILTER (WHERE pc.decision_status = 'APPROVED' AND l.status = '${LISTING_STATUSES.PUBLISH_FAILED}')::int AS publish_failed_count
    FROM profitable_candidates pc
    LEFT JOIN LATERAL (
      SELECT id, status
      FROM listings
      WHERE candidate_id = pc.id
        AND marketplace_key = pc.marketplace_key
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
      LIMIT 1
    ) l ON true
  `);

  const row = result.rows[0] ?? {};
  return {
    approvedCandidatesCount: toNumber(row.approved_candidates_count) ?? 0,
    listingEligibleCount: toNumber(row.listing_eligible_count) ?? 0,
    previewPreparedCount: toNumber(row.preview_prepared_count) ?? 0,
    readyToPublishCount: toNumber(row.ready_to_publish_count) ?? 0,
    publishFailedCount: toNumber(row.publish_failed_count) ?? 0,
  };
}

export async function getApprovedQueueItems(filters: ListingsQueueFilters): Promise<QueueListItem[]> {
  const values: unknown[] = [];
  const conditions: string[] = [
    `(
      pc.decision_status = 'APPROVED'
      OR (
        upper(coalesce(pc.listing_block_reason, '')) LIKE '%STALE_MARKETPLACE%'
        OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%STALE_SUPPLIER%'
        OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%SUPPLIER_PRICE_DRIFT%'
        OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%SUPPLIER_DRIFT%'
      )
    )`,
  ];

  if (filters.candidateId) {
    values.push(filters.candidateId);
    conditions.push(`pc.id = $${values.length}`);
  }

  if (filters.supplier) {
    values.push(filters.supplier);
    conditions.push(`pc.supplier_key = $${values.length}`);
  }

  if (filters.marketplace) {
    values.push(normalizeMarketplaceKey(filters.marketplace));
    conditions.push(`
      CASE
        WHEN LOWER(pc.marketplace_key) LIKE 'amazon%' THEN 'amazon'
        WHEN LOWER(pc.marketplace_key) LIKE 'ebay%' THEN 'ebay'
        ELSE LOWER(pc.marketplace_key)
      END = $${values.length}
    `);
  }

  if (filters.listingEligible === "yes") conditions.push("pc.listing_eligible = true");
  if (filters.listingEligible === "no") conditions.push("pc.listing_eligible = false");

  if (filters.previewPrepared === "yes") conditions.push("l.id IS NOT NULL");
  if (filters.previewPrepared === "no") conditions.push("l.id IS NULL");

  if (filters.listingStatus) {
    values.push(filters.listingStatus);
    conditions.push(`COALESCE(l.status, '') = $${values.length}`);
  }

  const minProfit = toNumber(filters.minProfit);
  if (minProfit != null) {
    values.push(minProfit);
    conditions.push(`COALESCE(pc.estimated_profit, 0) >= $${values.length}`);
  }

  const minMargin = toNumber(filters.minMargin);
  if (minMargin != null) {
    values.push(minMargin);
    conditions.push(`COALESCE(pc.margin_pct, 0) >= $${values.length}`);
  }

  const minRoi = toNumber(filters.minRoi);
  if (minRoi != null) {
    values.push(minRoi);
    conditions.push(`COALESCE(pc.roi_pct, 0) >= $${values.length}`);
  }

  const result = await pool.query<ListingQueueRow>(
    `
    SELECT
      pc.id,
      pc.supplier_key,
      pc.supplier_product_id,
      pc.marketplace_key,
      pc.marketplace_listing_id,
      pc.estimated_profit,
      pc.margin_pct,
      pc.roi_pct,
      pc.decision_status,
      pc.listing_eligible,
      pc.listing_block_reason,
      pc.approved_ts,
      pc.approved_by,
      l.id AS listing_id,
      l.status AS listing_status,
      l.title AS listing_title,
      l.price AS listing_price,
      l.quantity AS listing_quantity,
      l.payload AS listing_payload,
      l.response AS listing_response,
      l.created_at AS listing_created_at,
      l.updated_at AS listing_updated_at,
      (COALESCE(dup.conflict_count, 0) > 0) AS duplicate_detected,
      CASE
        WHEN COALESCE(dup.conflict_count, 0) > 0 THEN
          CONCAT('conflicting listing rows: ', array_to_string(dup.conflict_listing_ids, ', '))
        ELSE NULL
      END AS duplicate_reason,
      COALESCE(dup.conflict_listing_ids, ARRAY[]::text[]) AS duplicate_listing_ids
    FROM profitable_candidates pc
    LEFT JOIN LATERAL (
      SELECT *
      FROM listings
      WHERE candidate_id = pc.id
        AND marketplace_key = pc.marketplace_key
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
      LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS conflict_count,
        ARRAY_AGG(
          l2.id::text
          ORDER BY
            CASE l2.status
              WHEN 'ACTIVE' THEN 4
              WHEN 'PUBLISH_IN_PROGRESS' THEN 3
              WHEN 'READY_TO_PUBLISH' THEN 2
              WHEN 'PREVIEW' THEN 1
              ELSE 0
            END DESC,
            l2.updated_at DESC NULLS LAST
        ) AS conflict_listing_ids
      FROM listings l2
      INNER JOIN profitable_candidates pc2
        ON pc2.id = l2.candidate_id
      WHERE l2.marketplace_key = pc.marketplace_key
        AND l2.status IN ('PREVIEW', 'READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE')
        AND LOWER(pc2.supplier_key) = LOWER(pc.supplier_key)
        AND pc2.supplier_product_id = pc.supplier_product_id
        AND (l.id IS NULL OR l2.id <> l.id)
    ) dup ON true
    WHERE ${conditions.join(" AND ")}
    ORDER BY pc.calc_ts DESC NULLS LAST
    LIMIT 300
  `,
    values
  );

  return result.rows.map(mapQueueRow);
}

export async function getListingsQueueDetail(candidateId: string): Promise<ListingsQueueDetail | null> {
  const rows = await getApprovedQueueItems({
    supplier: "",
    marketplace: "",
    listingEligible: "",
    previewPrepared: "",
    listingStatus: "",
    minProfit: "",
    minMargin: "",
    minRoi: "",
    candidateId,
  });

  const item = rows[0] ?? null;
  if (!item) return null;

  const entityIds = [candidateId];
  if (item.listingId) entityIds.push(item.listingId);
  const placeholders = entityIds.map((_, index) => `$${index + 1}`).join(", ");

  const auditResult = await pool.query<QueryRow>(
    `
      SELECT id, event_ts, actor_type, actor_id, entity_type, entity_id, event_type, details
      FROM audit_log
      WHERE entity_id IN (${placeholders})
      ORDER BY event_ts DESC NULLS LAST
      LIMIT 25
    `,
    entityIds
  );

  return {
    item,
    recentAuditEvents: auditResult.rows.map((row) => ({
      id: String(row.id ?? ""),
      eventTs: toIsoString(row.event_ts) ?? "",
      actorType: String(row.actor_type ?? ""),
      actorId: row.actor_id == null ? null : String(row.actor_id),
      entityType: String(row.entity_type ?? ""),
      entityId: String(row.entity_id ?? ""),
      eventType: String(row.event_type ?? ""),
      details: row.details,
    })),
  };
}
