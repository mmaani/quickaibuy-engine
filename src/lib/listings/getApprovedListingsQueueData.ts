import { pool } from "@/lib/db";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { computeRecoveryState, type RecoveryState } from "@/lib/listings/recoveryState";
import { LISTING_STATUSES } from "@/lib/listings/statuses";
import {
  findListingDuplicatesForCandidate,
  getDuplicateBlockDecision,
} from "@/lib/listings/duplicateProtection";
import { readSupplierPolicySurface } from "@/lib/suppliers/policySurface";

export const LISTINGS_ROUTE = "/admin/listings";
export const LISTINGS_RISK_FILTERS = {
  AUTO_PAUSED: "auto-paused",
  MANUAL_REVIEW: "manual-review",
  STALE_SNAPSHOT: "stale-snapshot",
  OUT_OF_STOCK: "out-of-stock",
  SHIPPING_CHANGED: "shipping-changed",
} as const;

export type ListingRiskFilter = (typeof LISTINGS_RISK_FILTERS)[keyof typeof LISTINGS_RISK_FILTERS];

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
  estimated_fees: unknown;
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
  selection_mode: string | null;
  selection_summary: string | null;
  considered_sources: string[] | null;
  shipping_cost_component: string | number | null;
  shipping_origin_country: string | null;
  shipping_origin_source: string | null;
  shipping_origin_confidence: string | number | null;
  shipping_origin_validity: string | null;
  shipping_origin_unresolved_reason: string | null;
  supplier_warehouse_country: string | null;
  logistics_origin_hint: string | null;
  shipping_destination_country: string | null;
  shipping_quote_age_hours: string | number | null;
  shipping_resolution_mode: string | null;
  shipping_method: string | null;
  shipping_transparency_state: string | null;
  shipping_validity: string | null;
  shipping_error_reason: string | null;
  delivery_estimate_min_days: string | number | null;
  delivery_estimate_max_days: string | number | null;
  reprice_action: string | null;
  reprice_last_reason: string | null;
  reprice_last_evaluated_ts: string | null;
  reprice_last_applied_ts: string | null;
  supplier_reeval_status: string | null;
  supplier_reeval_best_supplier_key: string | null;
  supplier_reeval_best_supplier_product_id: string | null;
  supplier_reeval_current_landed_cost_usd: string | number | null;
  supplier_reeval_best_landed_cost_usd: string | number | null;
  supplier_reeval_evaluated_ts: string | null;
};

export type ListingsQueueFilters = {
  supplier: string;
  marketplace: string;
  listingEligible: string;
  previewPrepared: string;
  listingStatus: string;
  riskFilter: string;
  minProfit: string;
  minMargin: string;
  minRoi: string;
  candidateId: string;
};

export type RiskFilterLegend = {
  value: ListingRiskFilter;
  label: string;
  description: string;
  technicalLabel: string;
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
  selectionMode: string | null;
  selectionSummary: string | null;
  consideredSources: string[];
  shippingCostComponent: number | null;
  stockClass: string | null;
  stockConfidence: number | null;
  lowStockControlledRiskEligible: boolean;
  stockMonitoringPriority: string | null;
  supplierPolicyReason: string | null;
  supplierPolicyMessage: string | null;
  usPriorityStatus: string | null;
  shippingOriginCountry: string | null;
  shippingOriginSource: string | null;
  shippingOriginConfidence: number | null;
  shippingOriginValidity: string | null;
  shippingOriginUnresolvedReason: string | null;
  supplierWarehouseCountry: string | null;
  logisticsOriginHint: string | null;
  shippingDestinationCountry: string | null;
  shippingQuoteAgeHours: number | null;
  shippingResolutionMode: string | null;
  shippingMethod: string | null;
  shippingTransparencyState: string | null;
  shippingValidity: string | null;
  shippingErrorReason: string | null;
  deliveryEstimateMinDays: number | null;
  deliveryEstimateMaxDays: number | null;
  repriceAction: string | null;
  repriceLastReason: string | null;
  repriceLastEvaluatedTs: string | null;
  repriceLastAppliedTs: string | null;
  supplierReevaluationStatus: string | null;
  supplierReevaluationBestSupplierKey: string | null;
  supplierReevaluationBestSupplierProductId: string | null;
  supplierReevaluationCurrentLandedCostUsd: number | null;
  supplierReevaluationBestLandedCostUsd: number | null;
  supplierReevaluationEvaluatedTs: string | null;
  recoveryState: RecoveryState;
  recoveryNextAction: string;
  recoveryBlockReasonCode: string | null;
  recoveryReasonCodes: string[];
  reEvaluationNeeded: boolean;
  rePromotionReady: boolean;
  pausedByInventoryRisk: boolean;
  pauseReason: string | null;
  commercialState: string | null;
  firstSaleScore: number | null;
  firstSaleCandidate: boolean;
  payloadGateErrors: string[];
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
  latestRecoveryAudit: {
    eventType: string;
    eventTs: string;
  } | null;
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

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeRiskFilter(value: string | null | undefined): ListingRiskFilter | "" {
  const normalized = String(value ?? "").trim().toLowerCase();
  const allowed = Object.values(LISTINGS_RISK_FILTERS) as string[];
  return allowed.includes(normalized) ? (normalized as ListingRiskFilter) : "";
}

export function getRiskFilterLegend(filter: string): RiskFilterLegend | null {
  const value = normalizeRiskFilter(filter);
  if (!value) return null;

  if (value === LISTINGS_RISK_FILTERS.AUTO_PAUSED) {
    return {
      value,
      label: "Auto-paused listings",
      description: "Paused automatically for safety.",
      technicalLabel: "AUTO_PAUSE",
    };
  }
  if (value === LISTINGS_RISK_FILTERS.MANUAL_REVIEW) {
    return {
      value,
      label: "Manual review risk",
      description: "Requires human review before resuming.",
      technicalLabel: "MANUAL_REVIEW",
    };
  }
  if (value === LISTINGS_RISK_FILTERS.STALE_SNAPSHOT) {
    return {
      value,
      label: "Stale snapshot",
      description: "Supplier data is too old and needs a fresh check.",
      technicalLabel: "SNAPSHOT_TOO_OLD",
    };
  }
  if (value === LISTINGS_RISK_FILTERS.OUT_OF_STOCK) {
    return {
      value,
      label: "Out of stock",
      description: "Supplier availability check failed.",
      technicalLabel: "SUPPLIER_OUT_OF_STOCK",
    };
  }
  return {
    value,
    label: "Shipping changed",
    description: "Supplier shipping changed and needs review.",
    technicalLabel: "SUPPLIER_SHIPPING_CHANGED",
  };
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
  const response = asObject(row.listing_response);

  if (!title) missing.push("title");
  if (!(price && price > 0)) missing.push("price");
  if (!(quantity && quantity > 0)) missing.push("quantity");
  if (!payload) {
    missing.push("payload");
  } else if (normalizeMarketplaceKey(row.marketplace_key) === "ebay") {
    const source = asObject(payload.source);
    const shipFromCountry = String(payload.shipFromCountry ?? "").trim();
    if (!shipFromCountry) {
      missing.push("payload.shipFromCountry");
    } else if (!/^[A-Z]{2}$/.test(shipFromCountry)) {
      missing.push("payload.shipFromCountry (ISO-3166 alpha-2 required)");
    }
    if (!String(source?.supplierKey ?? "").trim()) {
      missing.push("payload.source.supplierKey");
    }
    if (!String(source?.supplierProductId ?? "").trim()) {
      missing.push("payload.source.supplierProductId");
    }
    const imageNormalization = asObject(response?.imageNormalization);
    if (imageNormalization?.ok !== true) {
      const code = String(imageNormalization?.code ?? "IMAGE_NORMALIZATION_PENDING").trim();
      const reason = String(imageNormalization?.blockingReason ?? "").trim();
      missing.push(reason ? `${code}: ${reason}` : code);
    }
    const payloadGate = asObject(response?.payloadGate);
    if (Array.isArray(payloadGate?.errors)) {
      for (const entry of payloadGate.errors) {
        const reason = String(entry ?? "").trim();
        if (reason) missing.push(reason);
      }
    }
  }

  return {
    previewStatus: missing.length ? "INCOMPLETE" : "PREPARED",
    previewMissingFields: missing,
  };
}

function mapQueueRow(row: ListingQueueRow): QueueListItem {
  const policySurface = readSupplierPolicySurface(row.estimated_fees);
  const readiness = evaluatePreviewReadiness(row);
  const recovery = computeRecoveryState({
    decisionStatus: row.decision_status,
    listingEligible: Boolean(row.listing_eligible),
    listingStatus: row.listing_status,
    listingBlockReason: row.listing_block_reason,
  });

  const listingResponse = asObject(row.listing_response);
  const inventoryRisk = asObject(listingResponse?.inventoryRisk);
  const riskAction = String(inventoryRisk?.action ?? "").toUpperCase();
  const perfReadiness = asObject(asObject(listingResponse?.listingPerformance)?.readiness);
  const payloadGateErrors = Array.isArray(asObject(listingResponse?.payloadGate)?.errors)
    ? (asObject(listingResponse?.payloadGate)?.errors as unknown[])
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
    : [];
  const pauseReason = Array.isArray(inventoryRisk?.signals)
    ? (inventoryRisk?.signals as Array<Record<string, unknown>>)
        .map((signal) => String(signal.code ?? "").trim())
        .filter(Boolean)
        .join(", ") || null
    : null;

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
    selectionMode: row.selection_mode ?? null,
    selectionSummary: row.selection_summary ?? null,
    consideredSources: row.considered_sources ?? [],
    shippingCostComponent: toNumber(row.shipping_cost_component),
    stockClass: policySurface.stockClass,
    stockConfidence: policySurface.stockConfidence,
    lowStockControlledRiskEligible: policySurface.lowStockControlledRiskEligible,
    stockMonitoringPriority: policySurface.monitoringPriority,
    supplierPolicyReason: policySurface.policyReason,
    supplierPolicyMessage: policySurface.operatorMessage,
    usPriorityStatus: policySurface.usPriorityStatus,
    shippingOriginCountry: row.shipping_origin_country ?? null,
    shippingOriginSource: row.shipping_origin_source ?? null,
    shippingOriginConfidence: toNumber(row.shipping_origin_confidence),
    shippingOriginValidity: row.shipping_origin_validity ?? null,
    shippingOriginUnresolvedReason: row.shipping_origin_unresolved_reason ?? null,
    supplierWarehouseCountry: row.supplier_warehouse_country ?? null,
    logisticsOriginHint: row.logistics_origin_hint ?? null,
    shippingDestinationCountry: row.shipping_destination_country ?? null,
    shippingQuoteAgeHours: toNumber(row.shipping_quote_age_hours),
    shippingResolutionMode: row.shipping_resolution_mode ?? null,
    shippingMethod: row.shipping_method ?? null,
    shippingTransparencyState: row.shipping_transparency_state ?? null,
    shippingValidity: row.shipping_validity ?? null,
    shippingErrorReason: row.shipping_error_reason ?? null,
    deliveryEstimateMinDays: toNumber(row.delivery_estimate_min_days),
    deliveryEstimateMaxDays: toNumber(row.delivery_estimate_max_days),
    repriceAction: row.reprice_action ?? null,
    repriceLastReason: row.reprice_last_reason ?? null,
    repriceLastEvaluatedTs: row.reprice_last_evaluated_ts ?? null,
    repriceLastAppliedTs: row.reprice_last_applied_ts ?? null,
    supplierReevaluationStatus: row.supplier_reeval_status ?? null,
    supplierReevaluationBestSupplierKey: row.supplier_reeval_best_supplier_key ?? null,
    supplierReevaluationBestSupplierProductId: row.supplier_reeval_best_supplier_product_id ?? null,
    supplierReevaluationCurrentLandedCostUsd: toNumber(row.supplier_reeval_current_landed_cost_usd),
    supplierReevaluationBestLandedCostUsd: toNumber(row.supplier_reeval_best_landed_cost_usd),
    supplierReevaluationEvaluatedTs: row.supplier_reeval_evaluated_ts ?? null,
    recoveryState: recovery.recoveryState,
    recoveryNextAction: recovery.recoveryNextAction,
    recoveryBlockReasonCode: recovery.recoveryBlockReasonCode,
    recoveryReasonCodes: recovery.recoveryReasonCodes,
    reEvaluationNeeded: recovery.reEvaluationNeeded,
    rePromotionReady: recovery.rePromotionReady,
    pausedByInventoryRisk: row.listing_status === LISTING_STATUSES.PAUSED && riskAction === "AUTO_PAUSE",
    pauseReason:
      row.listing_status === LISTING_STATUSES.PAUSED
        ? pauseReason
        : null,
    commercialState: stringOrNull(perfReadiness?.commercialState),
    firstSaleScore: toNumber(perfReadiness?.firstSaleScore),
    firstSaleCandidate: perfReadiness?.firstSaleCandidate === true,
    payloadGateErrors,
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
    riskFilter: normalizeRiskFilter(String(searchParams?.riskFilter ?? "").trim()),
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
      OR upper(coalesce(pc.decision_status, '')) = 'MANUAL_REVIEW'
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

  if (filters.riskFilter === LISTINGS_RISK_FILTERS.AUTO_PAUSED) {
    conditions.push(`
      upper(coalesce(l.status, '')) = 'PAUSED'
      AND upper(coalesce((l.response::jsonb)->'inventoryRisk'->>'action', '')) = 'AUTO_PAUSE'
    `);
  }

  if (filters.riskFilter === LISTINGS_RISK_FILTERS.MANUAL_REVIEW) {
    conditions.push(`
      upper(coalesce((l.response::jsonb)->'inventoryRisk'->>'action', '')) = 'MANUAL_REVIEW'
    `);
  }

  if (filters.riskFilter === LISTINGS_RISK_FILTERS.STALE_SNAPSHOT) {
    conditions.push(`
      exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof((l.response::jsonb)->'inventoryRisk'->'signals') = 'array'
              then (l.response::jsonb)->'inventoryRisk'->'signals'
            else '[]'::jsonb
          end
        ) sig
        where upper(coalesce(sig->>'code', '')) = 'SNAPSHOT_TOO_OLD'
      )
    `);
  }

  if (filters.riskFilter === LISTINGS_RISK_FILTERS.OUT_OF_STOCK) {
    conditions.push(`
      exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof((l.response::jsonb)->'inventoryRisk'->'signals') = 'array'
              then (l.response::jsonb)->'inventoryRisk'->'signals'
            else '[]'::jsonb
          end
        ) sig
        where upper(coalesce(sig->>'code', '')) = 'SUPPLIER_OUT_OF_STOCK'
      )
    `);
  }

  if (filters.riskFilter === LISTINGS_RISK_FILTERS.SHIPPING_CHANGED) {
    conditions.push(`
      exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof((l.response::jsonb)->'inventoryRisk'->'signals') = 'array'
              then (l.response::jsonb)->'inventoryRisk'->'signals'
            else '[]'::jsonb
          end
        ) sig
        where upper(coalesce(sig->>'code', '')) = 'SUPPLIER_SHIPPING_CHANGED'
      )
    `);
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
      pc.estimated_fees,
      pc.estimated_fees ->> 'selectionMode' AS selection_mode,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'selectionSummary' AS selection_summary,
      ARRAY(
        SELECT jsonb_array_elements_text(
          COALESCE(pc.estimated_fees -> 'selectedSupplierOption' -> 'consideredSources', '[]'::jsonb)
        )
      ) AS considered_sources,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'selectedShippingCostUsd' AS shipping_cost_component,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingOriginCountry' AS shipping_origin_country,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingOriginSource' AS shipping_origin_source,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingOriginConfidence' AS shipping_origin_confidence,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingOriginValidity' AS shipping_origin_validity,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingOriginUnresolvedReason' AS shipping_origin_unresolved_reason,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'supplierWarehouseCountry' AS supplier_warehouse_country,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'logisticsOriginHint' AS logistics_origin_hint,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingDestinationCountry' AS shipping_destination_country,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingQuoteAgeHours' AS shipping_quote_age_hours,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingResolutionMode' AS shipping_resolution_mode,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingMethod' AS shipping_method,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingTransparencyState' AS shipping_transparency_state,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingValidity' AS shipping_validity,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'shippingErrorReason' AS shipping_error_reason,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'deliveryEstimateMinDays' AS delivery_estimate_min_days,
      pc.estimated_fees -> 'selectedSupplierOption' ->> 'deliveryEstimateMaxDays' AS delivery_estimate_max_days,
      pc.approved_ts,
      pc.approved_by,
      l.id AS listing_id,
      l.status AS listing_status,
      l.title AS listing_title,
      l.price AS listing_price,
      l.quantity AS listing_quantity,
      l.payload AS listing_payload,
      l.response AS listing_response,
      l.response -> 'shippingRepricing' ->> 'action' AS reprice_action,
      l.response -> 'shippingRepricing' ->> 'lastReason' AS reprice_last_reason,
      l.response -> 'shippingRepricing' ->> 'lastEvaluatedTs' AS reprice_last_evaluated_ts,
      l.response -> 'shippingRepricing' ->> 'lastAppliedTs' AS reprice_last_applied_ts,
      l.response -> 'supplierReevaluation' ->> 'status' AS supplier_reeval_status,
      l.response -> 'supplierReevaluation' ->> 'bestSupplierKey' AS supplier_reeval_best_supplier_key,
      l.response -> 'supplierReevaluation' ->> 'bestSupplierProductId' AS supplier_reeval_best_supplier_product_id,
      l.response -> 'supplierReevaluation' ->> 'currentLandedCostUsd' AS supplier_reeval_current_landed_cost_usd,
      l.response -> 'supplierReevaluation' ->> 'bestLandedCostUsd' AS supplier_reeval_best_landed_cost_usd,
      l.response -> 'supplierReevaluation' ->> 'evaluatedAt' AS supplier_reeval_evaluated_ts,
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

  const items = result.rows.map(mapQueueRow);

  return Promise.all(
    items.map(async (item) => {
      const duplicateMatches = await findListingDuplicatesForCandidate({
        marketplaceKey: item.marketplaceKey,
        supplierKey: item.supplierKey,
        supplierProductId: item.supplierProductId,
        listingTitle: item.listingTitle,
        excludeListingId: item.listingId,
      });
      const duplicateDecision = getDuplicateBlockDecision(duplicateMatches);

      if (!duplicateDecision.blocked) {
        return {
          ...item,
          duplicateDetected: false,
          duplicateReason: null,
          duplicateListingIds: [],
        };
      }

      return {
        ...item,
        duplicateDetected: true,
        duplicateReason: duplicateDecision.reason,
        duplicateListingIds: duplicateDecision.duplicateListingIds,
      };
    })
  );
}

export async function getListingsQueueDetail(candidateId: string): Promise<ListingsQueueDetail | null> {
  const rows = await getApprovedQueueItems({
    supplier: "",
    marketplace: "",
    listingEligible: "",
    previewPrepared: "",
    listingStatus: "",
    riskFilter: "",
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
    latestRecoveryAudit:
      auditResult.rows
        .map((row) => ({
          eventType: String(row.event_type ?? ""),
          eventTs: toIsoString(row.event_ts) ?? "",
        }))
        .find((row) =>
          [
            "LISTING_BLOCKED_STALE_MARKETPLACE",
            "LISTING_BLOCKED_SUPPLIER_DRIFT",
            "LISTING_REFRESH_ENQUEUED_FOR_RECOVERY",
            "LISTING_REEVALUATED_AFTER_REFRESH",
            "LISTING_REEVALUATED_PAUSED_REQUIRES_RESUME",
            "LISTING_REPROMOTION_READY",
            "LISTING_PAUSED_INVENTORY_RISK",
            "LISTING_RESUME_REQUESTED",
            "LISTING_RESUMED_TO_PREVIEW",
          ].includes(row.eventType)
        ) ?? null,
  };
}
