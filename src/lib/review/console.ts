import { pool } from "@/lib/db";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { computeRecoveryState, type RecoveryState } from "@/lib/listings/recoveryState";
import {
  extractAvailabilityFromRawPayload,
  normalizeAvailabilitySignal,
  type AvailabilitySignal,
} from "@/lib/products/supplierAvailability";
import { classifySupplierEvidence } from "@/lib/products/supplierEvidenceClassification";
import {
  classifySupplierSnapshotQuality,
  normalizeSupplierTelemetry,
  type SupplierSnapshotQuality,
  type SupplierTelemetrySignal,
} from "@/lib/products/supplierQuality";

export const REVIEW_ROUTE = "/admin/review";
export const REVIEW_STATUSES = ["PENDING", "APPROVED", "MANUAL_REVIEW", "REJECTED", "RECHECK", "LISTED", "EXPIRED"] as const;
export const REVIEW_ACTION_STATUSES = ["APPROVED", "REJECTED", "RECHECK"] as const;
export const LOW_MATCH_CONFIDENCE_THRESHOLD = 0.71;
export const HIGH_MARGIN_THRESHOLD = 80;
const SUPPLIER_DRIFT_MANUAL_REVIEW_PCT = 15;
const SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS = 48;
export const BLOCKING_RISK_FLAGS = new Set([
  "LOW_MATCH_CONFIDENCE",
  "MISSING_SHIPPING_ESTIMATE",
  "SHIPPING_SIGNAL_MISSING",
  "SHIPPING_SIGNAL_WEAK",
  "BRAND_OR_RESTRICTED_TITLE",
  "DUPLICATE_CANDIDATE_PATTERN",
  "SUPPLIER_PRICE_DRIFT_EXCEEDS_15_PCT",
  "STALE_SUPPLIER_SNAPSHOT",
  "SUPPLIER_DRIFT_DATA_UNAVAILABLE",
  "SUPPLIER_OUT_OF_STOCK",
  "SUPPLIER_LOW_STOCK",
  "SUPPLIER_AVAILABILITY_UNKNOWN",
  "AVAILABILITY_NOT_CONFIRMED",
  "SOURCE_CHALLENGE_PAGE",
  "SOURCE_PROVIDER_BLOCK",
  "SUPPLIER_BLOCKED",
  "MEDIA_SIGNAL_WEAK",
  "SUPPLIER_SIGNAL_INSUFFICIENT",
]);

type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type ReviewSortKey =
  | "estimated_profit_desc"
  | "margin_pct_desc"
  | "roi_pct_desc"
  | "calc_ts_desc";

export type ReviewFilters = {
  supplier: string;
  marketplace: string;
  decisionStatus: string;
  minProfit: string;
  minMargin: string;
  minRoi: string;
  riskOnly: boolean;
  sort: ReviewSortKey;
  candidateId: string;
};

export type ReviewListItem = {
  id: string;
  supplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  estimatedProfit: number | null;
  marginPct: number | null;
  roiPct: number | null;
  decisionStatus: string;
  calcTs: string;
  matchConfidence: number | null;
  supplierTitle: string | null;
  marketplaceTitle: string | null;
  listingId: string | null;
  listingStatus: string | null;
  listingTitle: string | null;
  listingPrice: number | null;
  listingBlockReason: string | null;
  recoveryState: RecoveryState;
  recoveryNextAction: string;
  recoveryBlockReasonCode: string | null;
  recoveryReasonCodes: string[];
  supplierPriceDriftPct: number | null;
  supplierSnapshotAgeHours: number | null;
  availabilitySignal: AvailabilitySignal;
  availabilityConfidence: number | null;
  riskFlags: string[];
  blockingRiskFlags: string[];
  listingEligible: boolean;
  listingEligibilityReasons: string[];
  duplicateDetected: boolean;
  duplicateReason: string | null;
  duplicateListingIds: string[];
  selectionMode: string | null;
  selectionSummary: string | null;
  consideredSources: string[];
};

type CandidateRow = {
  id: string;
  supplier_key: string;
  supplier_product_id: string;
  marketplace_key: string;
  marketplace_listing_id: string;
  calc_ts: string | Date;
  estimated_profit: string | number | null;
  margin_pct: string | number | null;
  roi_pct: string | number | null;
  decision_status: string;
  reason: string | null;
  estimated_shipping: string | number | null;
  estimated_fees: unknown;
  estimated_cogs: string | number | null;
  risk_flags: string[] | null;
  supplier_snapshot_id: string;
  market_price_snapshot_id: string;
  supplier_title: string | null;
  marketplace_title: string | null;
  listing_id: string | null;
  listing_status: string | null;
  listing_marketplace_key?: string | null;
  listing_title: string | null;
  listing_price: string | number | null;
  listing_quantity?: string | number | null;
  listing_idempotency_key?: string | null;
  listing_payload?: unknown;
  listing_response?: unknown;
  listing_created_at?: string | Date | null;
  listing_updated_at?: string | Date | null;
  match_confidence: string | number | null;
  duplicate_count: string | number | null;
  duplicate_detected: boolean | null;
  duplicate_reason: string | null;
  duplicate_conflict_listing_ids: string[] | null;
  supplier_price_drift_pct?: string | number | null;
  supplier_snapshot_age_hours?: string | number | null;
  latest_supplier_availability_status?: string | null;
  latest_supplier_raw_payload?: unknown;
  listing_block_reason?: string | null;
  selection_mode?: string | null;
  selection_summary?: string | null;
  considered_sources?: string[] | null;
};

type SupplierSnapshot = {
  id: string;
  supplierKey: string;
  supplierProductId: string;
  sourceUrl: string | null;
  title: string | null;
  images: unknown;
  rawPayload: unknown;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  shippingEstimates: unknown;
  snapshotTs: string;
  snapshotQuality: SupplierSnapshotQuality;
  telemetrySignals: SupplierTelemetrySignal[];
  listingValidity: string | null;
  priceSignal: string | null;
  shippingSignal: string | null;
};

type MarketplaceSnapshot = {
  id: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  matchedTitle: string | null;
  productPageUrl: string | null;
  rawPayload: unknown;
  price: number | null;
  shippingPrice: number | null;
  currency: string | null;
  sellerName: string | null;
  sellerId: string | null;
  finalMatchScore: number | null;
  titleSimilarityScore: number | null;
  keywordScore: number | null;
  snapshotTs: string;
};

type MatchRecord = {
  id: string;
  matchType: string;
  confidence: number | null;
  evidence: unknown;
  status: string;
  firstSeenTs: string;
  lastSeenTs: string;
};

export type AuditEntry = {
  id: string;
  eventTs: string;
  actorType: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  eventType: string;
  details: unknown;
};

export type CandidateDetail = {
  candidate: ReviewListItem & {
    reason: string | null;
    estimatedShipping: number | null;
    estimatedCogs: number | null;
    estimatedFees: unknown;
    supplierSnapshotId: string;
    marketPriceSnapshotId: string;
    listingMarketplaceKey: string | null;
    listingQuantity: number | null;
    listingIdempotencyKey: string | null;
    listingPayload: Record<string, unknown> | null;
    listingResponse: Record<string, unknown> | null;
    listingCreatedAt: string | null;
    listingUpdatedAt: string | null;
  };
  supplierSnapshot: SupplierSnapshot | null;
  marketplaceSnapshot: MarketplaceSnapshot | null;
  match: MatchRecord | null;
  auditHistory: AuditEntry[];
};

type QueryResultRow = Record<string, unknown>;
let listingsTableExistsCache: boolean | null = null;

const SORT_SQL: Record<ReviewSortKey, string> = {
  estimated_profit_desc: `pc.estimated_profit DESC NULLS LAST, pc.calc_ts DESC NULLS LAST`,
  margin_pct_desc: `pc.margin_pct DESC NULLS LAST, pc.calc_ts DESC NULLS LAST`,
  roi_pct_desc: `pc.roi_pct DESC NULLS LAST, pc.calc_ts DESC NULLS LAST`,
  calc_ts_desc: `pc.calc_ts DESC NULLS LAST`,
};

const BRAND_RISK_PATTERNS = [
  "nike",
  "adidas",
  "apple",
  "samsung",
  "sony",
  "lego",
  "disney",
  "gucci",
  "pokemon",
  "dyson",
];

const RESTRICTED_PATTERNS = [
  "supplement",
  "medical",
  "baby",
  "fragrance",
  "perfume",
  "battery",
  "toy",
  "cosmetic",
];

async function hasListingsTable(): Promise<boolean> {
  if (listingsTableExistsCache != null) return listingsTableExistsCache;
  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'listings'
      ) AS exists
    `
  );
  listingsTableExistsCache = Boolean(result.rows[0]?.exists);
  return listingsTableExistsCache;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractImageUrl(images: unknown, rawPayload: unknown): string | null {
  if (Array.isArray(images)) {
    for (const item of images) {
      if (typeof item === "string" && item.trim()) return item.trim();
      const objectItem = asObject(item);
      const fromItem =
        (typeof objectItem?.imageUrl === "string" && objectItem.imageUrl) ||
        (typeof objectItem?.url === "string" && objectItem.url) ||
        (typeof objectItem?.src === "string" && objectItem.src);
      if (fromItem) return fromItem;
    }
  }

  const payload = asObject(rawPayload);
  if (!payload) return null;

  const direct =
    (typeof payload.imageUrl === "string" && payload.imageUrl) ||
    (typeof payload.image === "string" && payload.image);
  if (direct) return direct;

  const imageObject = asObject(payload.image);
  if (typeof imageObject?.imageUrl === "string") return imageObject.imageUrl;
  if (typeof imageObject?.url === "string") return imageObject.url;

  const firstThumbnail = Array.isArray(payload.thumbnailImages) ? asObject(payload.thumbnailImages[0]) : null;
  if (typeof firstThumbnail?.imageUrl === "string") return firstThumbnail.imageUrl;

  return null;
}

function hasBrandedOrRestrictedTitle(input: string): boolean {
  const normalized = input.toLowerCase();
  return [...BRAND_RISK_PATTERNS, ...RESTRICTED_PATTERNS].some((pattern) => normalized.includes(pattern));
}

function deriveRiskFlags(row: CandidateRow): string[] {
  const legacyNormalizedFlags = (row.risk_flags ?? [])
    .filter(Boolean)
    .map((flag) => {
      if (flag === "SUPPLIER_AVAILABILITY_UNKNOWN" || flag === "SUPPLIER_AVAILABILITY_LOW_CONFIDENCE") {
        return "AVAILABILITY_NOT_CONFIRMED";
      }
      if (flag === "MISSING_SHIPPING_ESTIMATE") return "SHIPPING_SIGNAL_MISSING";
      if (flag === "SHIPPING_STABILITY_WEAK") return "SHIPPING_SIGNAL_WEAK";
      if (flag === "WEAK_MEDIA") return "MEDIA_SIGNAL_WEAK";
      return flag;
    });
  const flags = new Set<string>(legacyNormalizedFlags);
  const confidence = toNumber(row.match_confidence);
  const estimatedShipping = toNumber(row.estimated_shipping);
  const marginPct = toNumber(row.margin_pct);
  const duplicateCount = toNumber(row.duplicate_count) ?? 1;
  const supplierPriceDriftPct = toNumber(row.supplier_price_drift_pct);
  const supplierSnapshotAgeHours = toNumber(row.supplier_snapshot_age_hours);
  const availability = extractAvailabilityFromRawPayload({
    availabilityStatus: row.latest_supplier_availability_status,
    rawPayload: row.latest_supplier_raw_payload,
  });
  const availabilitySignal = normalizeAvailabilitySignal(availability.signal);
  const availabilityConfidence = availability.confidence;
  const supplierPayload = asObject(row.latest_supplier_raw_payload);
  const supplierSnapshotQuality = classifySupplierSnapshotQuality({
    rawPayload: supplierPayload,
    availabilitySignal,
    availabilityConfidence,
  });
  const supplierTelemetry = normalizeSupplierTelemetry(supplierPayload);
  const supplierEvidence = classifySupplierEvidence({
    availabilitySignal,
    availabilityConfidence,
    sourceQuality: supplierSnapshotQuality,
    rawPayload: supplierPayload,
    telemetrySignals: supplierTelemetry.signals,
  });
  const joinedTitle = `${row.supplier_title ?? ""} ${row.marketplace_title ?? ""}`.trim();

  if (confidence != null && confidence < LOW_MATCH_CONFIDENCE_THRESHOLD) {
    flags.add("LOW_MATCH_CONFIDENCE");
  }

  if (
    estimatedShipping === null ||
    estimatedShipping === undefined ||
    Number.isNaN(estimatedShipping)
  ) {
    if (!supplierEvidence.codes.includes("SOURCE_CHALLENGE_PAGE") && !supplierEvidence.codes.includes("SOURCE_PROVIDER_BLOCK")) {
      flags.add("SHIPPING_SIGNAL_MISSING");
    }
  } else {
    flags.delete("MISSING_SHIPPING_ESTIMATE");
  }

  if (joinedTitle && hasBrandedOrRestrictedTitle(joinedTitle)) {
    flags.add("BRAND_OR_RESTRICTED_TITLE");
  }

  if (marginPct != null && marginPct >= HIGH_MARGIN_THRESHOLD) {
    flags.add("UNUSUALLY_HIGH_MARGIN");
  }

  if (duplicateCount > 1) {
    flags.add("DUPLICATE_CANDIDATE_PATTERN");
  }

  if (supplierPriceDriftPct == null) {
    flags.add("SUPPLIER_DRIFT_DATA_UNAVAILABLE");
  } else if (Math.abs(supplierPriceDriftPct) > SUPPLIER_DRIFT_MANUAL_REVIEW_PCT) {
    flags.add("SUPPLIER_PRICE_DRIFT_EXCEEDS_15_PCT");
  }

  if (
    supplierSnapshotAgeHours != null &&
    supplierSnapshotAgeHours > SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS
  ) {
    flags.add("STALE_SUPPLIER_SNAPSHOT");
  }

  for (const code of supplierEvidence.codes) {
    flags.add(code);
  }

  return Array.from(flags);
}

function computeListingEligibility(input: {
  decisionStatus: string;
  estimatedProfit: number | null;
  confidence: number | null;
  riskFlags: string[];
  supplierPriceDriftPct: number | null;
  supplierSnapshotAgeHours: number | null;
  availabilitySignal: AvailabilitySignal;
  availabilityConfidence: number | null;
}) {
  const reasons: string[] = [];

  if (input.decisionStatus !== "APPROVED") {
    reasons.push("decision_status is not APPROVED");
  }

  if ((input.estimatedProfit ?? 0) <= 0) {
    reasons.push("estimated_profit must be greater than 0");
  }

  if ((input.confidence ?? 0) < LOW_MATCH_CONFIDENCE_THRESHOLD) {
    reasons.push(`match confidence must be at least ${LOW_MATCH_CONFIDENCE_THRESHOLD}`);
  }

  const blockingFlags = input.riskFlags.filter((flag) => BLOCKING_RISK_FLAGS.has(flag));
  if (blockingFlags.length) {
    reasons.push(`blocking risk flags: ${blockingFlags.join(", ")}`);
  }

  // Publish/readiness drift gate: fail closed if drift metrics are missing.
  if (input.supplierPriceDriftPct == null) {
    reasons.push("supplier_price_drift_pct is required for publish safety");
  } else if (Math.abs(input.supplierPriceDriftPct) > SUPPLIER_DRIFT_MANUAL_REVIEW_PCT) {
    reasons.push(`supplier_price_drift_pct exceeds ${SUPPLIER_DRIFT_MANUAL_REVIEW_PCT}%`);
  }

  // Supplier snapshot freshness gate for publish/readiness.
  if (input.supplierSnapshotAgeHours == null) {
    reasons.push("supplier_snapshot_age_hours is required for publish safety");
  } else if (input.supplierSnapshotAgeHours > SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS) {
    reasons.push(`supplier_snapshot_age_hours exceeds ${SUPPLIER_SNAPSHOT_REFRESH_MAX_AGE_HOURS}h`);
  }

  if (input.availabilitySignal === "OUT_OF_STOCK") {
    reasons.push("supplier availability indicates out of stock");
  } else if (input.availabilitySignal === "LOW_STOCK") {
    reasons.push("supplier availability is low stock and requires manual review");
  }

  if (
    input.riskFlags.includes("AVAILABILITY_NOT_CONFIRMED") &&
    !input.riskFlags.includes("SHIPPING_SIGNAL_MISSING") &&
    !input.riskFlags.includes("SHIPPING_SIGNAL_WEAK") &&
    !input.riskFlags.includes("SOURCE_CHALLENGE_PAGE") &&
    !input.riskFlags.includes("SOURCE_PROVIDER_BLOCK")
  ) {
    reasons.push("supplier availability is not confirmed");
  }

  if (input.riskFlags.includes("SHIPPING_SIGNAL_MISSING")) {
    reasons.push("shipping signal is missing");
  } else if (input.riskFlags.includes("SHIPPING_SIGNAL_WEAK")) {
    reasons.push("shipping signal is weak");
  }

  if (
    input.availabilityConfidence != null &&
    input.availabilityConfidence < 0.5 &&
    !input.riskFlags.includes("AVAILABILITY_NOT_CONFIRMED")
  ) {
    reasons.push("supplier availability confidence is low");
  }

  return {
    listingEligible: reasons.length === 0,
    listingEligibilityReasons: reasons,
    blockingRiskFlags: blockingFlags,
  };
}

function mapRowToListItem(row: CandidateRow): ReviewListItem {
  const estimatedProfit = toNumber(row.estimated_profit);
  const marginPct = toNumber(row.margin_pct);
  const roiPct = toNumber(row.roi_pct);
  const matchConfidence = toNumber(row.match_confidence);
  const supplierPriceDriftPct = toNumber(row.supplier_price_drift_pct);
  const supplierSnapshotAgeHours = toNumber(row.supplier_snapshot_age_hours);
  const availability = extractAvailabilityFromRawPayload({
    availabilityStatus: row.latest_supplier_availability_status,
    rawPayload: row.latest_supplier_raw_payload,
  });
  const availabilitySignal = normalizeAvailabilitySignal(availability.signal);
  const availabilityConfidence = availability.confidence;
  const riskFlags = deriveRiskFlags(row);
  const eligibility = computeListingEligibility({
    decisionStatus: row.decision_status,
    estimatedProfit,
    confidence: matchConfidence,
    riskFlags,
    supplierPriceDriftPct,
    supplierSnapshotAgeHours,
    availabilitySignal,
    availabilityConfidence,
  });
  const listingBlockReason = row.listing_block_reason ?? null;
  const recovery = computeRecoveryState({
    decisionStatus: row.decision_status,
    listingEligible: eligibility.listingEligible,
    listingStatus: row.listing_status,
    listingBlockReason,
  });

  return {
    id: row.id,
    supplierKey: row.supplier_key,
    supplierProductId: row.supplier_product_id,
    marketplaceKey: normalizeMarketplaceKey(row.marketplace_key),
    marketplaceListingId: row.marketplace_listing_id,
    estimatedProfit,
    marginPct,
    roiPct,
    decisionStatus: row.decision_status,
    calcTs: toIsoString(row.calc_ts),
    matchConfidence,
    supplierTitle: row.supplier_title,
    marketplaceTitle: row.marketplace_title,
    listingId: row.listing_id,
    listingStatus: row.listing_status,
    listingTitle: row.listing_title,
    listingPrice: toNumber(row.listing_price),
    listingBlockReason,
    recoveryState: recovery.recoveryState,
    recoveryNextAction: recovery.recoveryNextAction,
    recoveryBlockReasonCode: recovery.recoveryBlockReasonCode,
    recoveryReasonCodes: recovery.recoveryReasonCodes,
    supplierPriceDriftPct,
    supplierSnapshotAgeHours,
    availabilitySignal,
    availabilityConfidence,
    riskFlags,
    blockingRiskFlags: eligibility.blockingRiskFlags,
    listingEligible: eligibility.listingEligible,
    listingEligibilityReasons: eligibility.listingEligibilityReasons,
    duplicateDetected: Boolean(row.duplicate_detected),
    duplicateReason: row.duplicate_reason ?? null,
    duplicateListingIds: row.duplicate_conflict_listing_ids ?? [],
    selectionMode: row.selection_mode ?? null,
    selectionSummary: row.selection_summary ?? null,
    consideredSources: row.considered_sources ?? [],
  };
}

export function getReviewFiltersFromSearchParams(
  searchParams?: Record<string, string | string[] | undefined>
): ReviewFilters {
  const supplier = String(searchParams?.supplier ?? "").trim();
  const marketplace = String(searchParams?.marketplace ?? "").trim();
  const decisionStatus = String(searchParams?.decisionStatus ?? "").trim().toUpperCase();
  const minProfit = String(searchParams?.minProfit ?? "").trim();
  const minMargin = String(searchParams?.minMargin ?? "").trim();
  const minRoi = String(searchParams?.minRoi ?? "").trim();
  const candidateId = String(searchParams?.candidateId ?? "").trim();
  const riskOnly = String(searchParams?.riskOnly ?? "").trim() === "1";
  const sortCandidate = String(searchParams?.sort ?? "").trim() as ReviewSortKey;

  return {
    supplier,
    marketplace,
    decisionStatus,
    minProfit,
    minMargin,
    minRoi,
    riskOnly,
    sort: sortCandidate in SORT_SQL ? sortCandidate : "calc_ts_desc",
    candidateId,
  };
}

export async function getReviewFilterOptions(): Promise<{
  suppliers: string[];
  marketplaces: string[];
}> {
  const [suppliersResult, marketplacesResult] = await Promise.all([
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
        SELECT DISTINCT marketplace_key
        FROM (
          SELECT
            CASE
              WHEN LOWER(marketplace_key) LIKE 'amazon%' THEN 'amazon'
              WHEN LOWER(marketplace_key) LIKE 'ebay%' THEN 'ebay'
              ELSE LOWER(marketplace_key)
            END AS marketplace_key
          FROM profitable_candidates
          UNION ALL
          SELECT
            CASE
              WHEN LOWER(marketplace_key) LIKE 'amazon%' THEN 'amazon'
              WHEN LOWER(marketplace_key) LIKE 'ebay%' THEN 'ebay'
              ELSE LOWER(marketplace_key)
            END AS marketplace_key
          FROM matches
          UNION ALL
          SELECT
            CASE
              WHEN LOWER(marketplace_key) LIKE 'amazon%' THEN 'amazon'
              WHEN LOWER(marketplace_key) LIKE 'ebay%' THEN 'ebay'
              ELSE LOWER(marketplace_key)
            END AS marketplace_key
          FROM marketplace_prices
        ) m
        WHERE marketplace_key IS NOT NULL AND marketplace_key <> ''
        ORDER BY marketplace_key ASC
      `
    ),
  ]);

  return {
    suppliers: suppliersResult.rows.map((row) => row.supplier_key),
    marketplaces: marketplacesResult.rows.map((row) => row.marketplace_key),
  };
}

export async function getReviewCandidates(filters: ReviewFilters): Promise<ReviewListItem[]> {
  const listingsAvailable = await hasListingsTable();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.supplier) {
    values.push(filters.supplier);
    conditions.push(`pc.supplier_key = $${values.length}`);
  }

  if (filters.marketplace) {
    values.push(normalizeMarketplaceKey(filters.marketplace));
    conditions.push(`
      (
        CASE
          WHEN LOWER(pc.marketplace_key) LIKE 'amazon%' THEN 'amazon'
          WHEN LOWER(pc.marketplace_key) LIKE 'ebay%' THEN 'ebay'
          ELSE LOWER(pc.marketplace_key)
        END
      ) = $${values.length}
    `);
  }

  if (filters.decisionStatus && REVIEW_STATUSES.includes(filters.decisionStatus as ReviewStatus)) {
    values.push(filters.decisionStatus);
    conditions.push(`pc.decision_status = $${values.length}`);
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

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderClause = SORT_SQL[filters.sort];
  const listingSelectClause = listingsAvailable
    ? `
        l.id AS listing_id,
        l.status AS listing_status,
        l.title AS listing_title,
        l.price AS listing_price,
      `
    : `
        NULL::uuid AS listing_id,
        NULL::text AS listing_status,
        NULL::text AS listing_title,
        NULL::numeric AS listing_price,
      `;
  const listingJoinClause = listingsAvailable
    ? `
      LEFT JOIN LATERAL (
        SELECT id, status, title, price
        FROM listings
        WHERE candidate_id = pc.id
          AND marketplace_key = pc.marketplace_key
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 1
      ) l ON true
    `
    : "";
  const duplicateSelectClause = listingsAvailable
    ? `
        COALESCE(dup.conflict_count, 0)::int AS duplicate_conflict_count,
        COALESCE(dup.conflict_listing_ids, ARRAY[]::text[]) AS duplicate_conflict_listing_ids,
        (COALESCE(dup.conflict_count, 0) > 0) AS duplicate_detected,
        CASE
          WHEN COALESCE(dup.conflict_count, 0) > 0 THEN
            CONCAT('conflicting listing rows: ', array_to_string(dup.conflict_listing_ids, ', '))
          ELSE NULL
        END AS duplicate_reason,
      `
    : `
        0::int AS duplicate_conflict_count,
        ARRAY[]::text[] AS duplicate_conflict_listing_ids,
        FALSE AS duplicate_detected,
        NULL::text AS duplicate_reason,
      `;
  const duplicateJoinClause = listingsAvailable
    ? `
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
    `
    : "";

  const result = await pool.query<CandidateRow>(
    `
      SELECT
        pc.id,
        pc.supplier_key,
        pc.supplier_product_id,
        pc.marketplace_key,
        pc.marketplace_listing_id,
        pc.calc_ts,
        pc.estimated_profit,
        pc.margin_pct,
        pc.roi_pct,
        pc.decision_status,
        pc.reason,
        pc.estimated_shipping,
        pc.estimated_fees,
        pc.estimated_fees ->> 'selectionMode' AS selection_mode,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'selectionSummary' AS selection_summary,
        ARRAY(
          SELECT jsonb_array_elements_text(
            COALESCE(pc.estimated_fees -> 'selectedSupplierOption' -> 'consideredSources', '[]'::jsonb)
          )
        ) AS considered_sources,
        pc.estimated_cogs,
        pc.risk_flags,
        pc.listing_block_reason,
        pc.supplier_snapshot_id,
        pc.market_price_snapshot_id,
        pr.title AS supplier_title,
        mp.matched_title AS marketplace_title,
        ${listingSelectClause}
        ${duplicateSelectClause}
        ROUND(
          ((latest_pr.price_min - expected_pr.price_min) / NULLIF(expected_pr.price_min, 0) * 100)::numeric,
          2
        )::text AS supplier_price_drift_pct,
        ROUND(
          (EXTRACT(EPOCH FROM (NOW() - latest_pr.snapshot_ts)) / 3600.0)::numeric,
          2
        )::text AS supplier_snapshot_age_hours,
        latest_pr.availability_status AS latest_supplier_availability_status,
        latest_pr.raw_payload AS latest_supplier_raw_payload,
        m.confidence AS match_confidence,
        (
          SELECT COUNT(*)
          FROM profitable_candidates dup
          WHERE dup.supplier_product_id = pc.supplier_product_id
            AND dup.marketplace_key = pc.marketplace_key
            AND dup.marketplace_listing_id = pc.marketplace_listing_id
        ) AS duplicate_count
      FROM profitable_candidates pc
      LEFT JOIN products_raw pr
        ON pr.id = pc.supplier_snapshot_id
      LEFT JOIN marketplace_prices mp
        ON mp.id = pc.market_price_snapshot_id
      LEFT JOIN products_raw expected_pr
        ON expected_pr.id = pc.supplier_snapshot_id
      LEFT JOIN LATERAL (
        SELECT pr_latest.price_min, pr_latest.snapshot_ts, pr_latest.availability_status, pr_latest.raw_payload
        FROM products_raw pr_latest
        WHERE pr_latest.supplier_key = pc.supplier_key
          AND pr_latest.supplier_product_id = pc.supplier_product_id
        ORDER BY pr_latest.snapshot_ts DESC, pr_latest.id DESC
        LIMIT 1
      ) latest_pr ON true
      ${listingJoinClause}
      ${duplicateJoinClause}
      LEFT JOIN LATERAL (
        SELECT confidence
        FROM matches
        WHERE supplier_key = pc.supplier_key
          AND supplier_product_id = pc.supplier_product_id
          AND marketplace_key = pc.marketplace_key
          AND marketplace_listing_id = pc.marketplace_listing_id
        ORDER BY last_seen_ts DESC NULLS LAST
        LIMIT 1
      ) m ON true
      ${whereClause}
      ORDER BY ${orderClause}
      LIMIT 250
    `,
    values
  );

  const items = result.rows.map(mapRowToListItem);
  return filters.riskOnly ? items.filter((item) => item.riskFlags.length > 0) : items;
}

function mapSupplierSnapshot(row: QueryResultRow | undefined): SupplierSnapshot | null {
  if (!row) return null;

  const payload = asObject(row.raw_payload);
  const telemetry = normalizeSupplierTelemetry(payload);

  return {
    id: String(row.id),
    supplierKey: String(row.supplier_key),
    supplierProductId: String(row.supplier_product_id),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    title: row.title == null ? null : String(row.title),
    images: row.images,
    rawPayload: row.raw_payload,
    priceMin: toNumber(row.price_min),
    priceMax: toNumber(row.price_max),
    currency: row.currency == null ? null : String(row.currency),
    shippingEstimates: row.shipping_estimates,
    snapshotTs: toIsoString(row.snapshot_ts),
    snapshotQuality: classifySupplierSnapshotQuality({
      rawPayload: payload,
      availabilitySignal: row.availability_status,
      price: row.price_min ?? row.price_max,
      title: row.title,
      sourceUrl: row.source_url,
      images: row.images,
      shippingEstimates: row.shipping_estimates,
    }),
    telemetrySignals: telemetry.signals,
    listingValidity: typeof payload?.listingValidity === "string" ? payload.listingValidity : null,
    priceSignal: typeof payload?.priceSignal === "string" ? payload.priceSignal : null,
    shippingSignal: typeof payload?.shippingSignal === "string" ? payload.shippingSignal : null,
  };
}

function mapMarketplaceSnapshot(row: QueryResultRow | undefined): MarketplaceSnapshot | null {
  if (!row) return null;

  return {
    id: String(row.id),
    marketplaceKey: normalizeMarketplaceKey(String(row.marketplace_key)),
    marketplaceListingId: String(row.marketplace_listing_id),
    matchedTitle: row.matched_title == null ? null : String(row.matched_title),
    productPageUrl: row.product_page_url == null ? null : String(row.product_page_url),
    rawPayload: row.raw_payload,
    price: toNumber(row.price),
    shippingPrice: toNumber(row.shipping_price),
    currency: row.currency == null ? null : String(row.currency),
    sellerName: row.seller_name == null ? null : String(row.seller_name),
    sellerId: row.seller_id == null ? null : String(row.seller_id),
    finalMatchScore: toNumber(row.final_match_score),
    titleSimilarityScore: toNumber(row.title_similarity_score),
    keywordScore: toNumber(row.keyword_score),
    snapshotTs: toIsoString(row.snapshot_ts),
  };
}

function mapMatchRecord(row: QueryResultRow | undefined): MatchRecord | null {
  if (!row) return null;

  return {
    id: String(row.id),
    matchType: String(row.match_type),
    confidence: toNumber(row.confidence),
    evidence: row.evidence,
    status: String(row.status),
    firstSeenTs: toIsoString(row.first_seen_ts),
    lastSeenTs: toIsoString(row.last_seen_ts),
  };
}

function mapAuditEntry(row: QueryResultRow): AuditEntry {
  return {
    id: String(row.id),
    eventTs: toIsoString(row.event_ts),
    actorType: String(row.actor_type),
    actorId: row.actor_id == null ? null : String(row.actor_id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    eventType: String(row.event_type),
    details: row.details,
  };
}

export async function getCandidateDetail(candidateId: string): Promise<CandidateDetail | null> {
  if (!candidateId) return null;
  const listingsAvailable = await hasListingsTable();
  const listingSelectClause = listingsAvailable
    ? `
        l.id AS listing_id,
        l.status AS listing_status,
        l.marketplace_key AS listing_marketplace_key,
        l.title AS listing_title,
        l.price AS listing_price,
        l.quantity AS listing_quantity,
        l.idempotency_key AS listing_idempotency_key,
        l.payload AS listing_payload,
        l.response AS listing_response,
        l.created_at AS listing_created_at,
        l.updated_at AS listing_updated_at,
      `
    : `
        NULL::uuid AS listing_id,
        NULL::text AS listing_status,
        NULL::text AS listing_marketplace_key,
        NULL::text AS listing_title,
        NULL::numeric AS listing_price,
        NULL::int AS listing_quantity,
        NULL::text AS listing_idempotency_key,
        NULL::jsonb AS listing_payload,
        NULL::jsonb AS listing_response,
        NULL::timestamp AS listing_created_at,
        NULL::timestamp AS listing_updated_at,
      `;
  const listingJoinClause = listingsAvailable
    ? `
      LEFT JOIN LATERAL (
        SELECT
          id,
          status,
          marketplace_key,
          title,
          price,
          quantity,
          idempotency_key,
          payload,
          response,
          created_at,
          updated_at
        FROM listings
        WHERE candidate_id = pc.id
          AND marketplace_key = pc.marketplace_key
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        LIMIT 1
      ) l ON true
    `
    : "";
  const duplicateSelectClause = listingsAvailable
    ? `
        COALESCE(dup.conflict_count, 0)::int AS duplicate_conflict_count,
        COALESCE(dup.conflict_listing_ids, ARRAY[]::text[]) AS duplicate_conflict_listing_ids,
        (COALESCE(dup.conflict_count, 0) > 0) AS duplicate_detected,
        CASE
          WHEN COALESCE(dup.conflict_count, 0) > 0 THEN
            CONCAT('conflicting listing rows: ', array_to_string(dup.conflict_listing_ids, ', '))
          ELSE NULL
        END AS duplicate_reason,
      `
    : `
        0::int AS duplicate_conflict_count,
        ARRAY[]::text[] AS duplicate_conflict_listing_ids,
        FALSE AS duplicate_detected,
        NULL::text AS duplicate_reason,
      `;
  const duplicateJoinClause = listingsAvailable
    ? `
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
    `
    : "";

  const candidateResult = await pool.query<CandidateRow>(
    `
      SELECT
        pc.id,
        pc.supplier_key,
        pc.supplier_product_id,
        pc.marketplace_key,
        pc.marketplace_listing_id,
        pc.calc_ts,
        pc.estimated_profit,
        pc.margin_pct,
        pc.roi_pct,
        pc.decision_status,
        pc.reason,
        pc.estimated_shipping,
        pc.estimated_fees,
        pc.estimated_fees ->> 'selectionMode' AS selection_mode,
        pc.estimated_fees -> 'selectedSupplierOption' ->> 'selectionSummary' AS selection_summary,
        ARRAY(
          SELECT jsonb_array_elements_text(
            COALESCE(pc.estimated_fees -> 'selectedSupplierOption' -> 'consideredSources', '[]'::jsonb)
          )
        ) AS considered_sources,
        pc.estimated_cogs,
        pc.risk_flags,
        pc.listing_block_reason,
        pc.supplier_snapshot_id,
        pc.market_price_snapshot_id,
        pr.title AS supplier_title,
        mp.matched_title AS marketplace_title,
        ${listingSelectClause}
        ${duplicateSelectClause}
        ROUND(
          ((latest_pr.price_min - expected_pr.price_min) / NULLIF(expected_pr.price_min, 0) * 100)::numeric,
          2
        )::text AS supplier_price_drift_pct,
        ROUND(
          (EXTRACT(EPOCH FROM (NOW() - latest_pr.snapshot_ts)) / 3600.0)::numeric,
          2
        )::text AS supplier_snapshot_age_hours,
        latest_pr.availability_status AS latest_supplier_availability_status,
        latest_pr.raw_payload AS latest_supplier_raw_payload,
        m.confidence AS match_confidence,
        (
          SELECT COUNT(*)
          FROM profitable_candidates dup
          WHERE dup.supplier_product_id = pc.supplier_product_id
            AND dup.marketplace_key = pc.marketplace_key
            AND dup.marketplace_listing_id = pc.marketplace_listing_id
        ) AS duplicate_count
      FROM profitable_candidates pc
      LEFT JOIN products_raw pr
        ON pr.id = pc.supplier_snapshot_id
      LEFT JOIN marketplace_prices mp
        ON mp.id = pc.market_price_snapshot_id
      LEFT JOIN products_raw expected_pr
        ON expected_pr.id = pc.supplier_snapshot_id
      LEFT JOIN LATERAL (
        SELECT pr_latest.price_min, pr_latest.snapshot_ts, pr_latest.availability_status, pr_latest.raw_payload
        FROM products_raw pr_latest
        WHERE pr_latest.supplier_key = pc.supplier_key
          AND pr_latest.supplier_product_id = pc.supplier_product_id
        ORDER BY pr_latest.snapshot_ts DESC, pr_latest.id DESC
        LIMIT 1
      ) latest_pr ON true
      ${listingJoinClause}
      ${duplicateJoinClause}
      LEFT JOIN LATERAL (
        SELECT confidence
        FROM matches
        WHERE supplier_key = pc.supplier_key
          AND supplier_product_id = pc.supplier_product_id
          AND marketplace_key = pc.marketplace_key
          AND marketplace_listing_id = pc.marketplace_listing_id
        ORDER BY last_seen_ts DESC NULLS LAST
        LIMIT 1
      ) m ON true
      WHERE pc.id = $1
      LIMIT 1
    `,
    [candidateId]
  );

  const candidateRow = candidateResult.rows[0];
  if (!candidateRow) return null;

  const [supplierResult, marketplaceResult, matchResult] = await Promise.all([
    pool.query(
      `
        SELECT *
        FROM products_raw
        WHERE id = $1
        LIMIT 1
      `,
      [candidateRow.supplier_snapshot_id]
    ),
    pool.query(
      `
        SELECT *
        FROM marketplace_prices
        WHERE id = $1
        LIMIT 1
      `,
      [candidateRow.market_price_snapshot_id]
    ),
    pool.query(
      `
        SELECT *
        FROM matches
        WHERE supplier_key = $1
          AND supplier_product_id = $2
          AND marketplace_key = $3
          AND marketplace_listing_id = $4
        ORDER BY last_seen_ts DESC NULLS LAST
        LIMIT 1
      `,
      [
        candidateRow.supplier_key,
        candidateRow.supplier_product_id,
        candidateRow.marketplace_key,
        candidateRow.marketplace_listing_id,
      ]
    ),
  ]);

  const matchRecord = mapMatchRecord(matchResult.rows[0] as QueryResultRow | undefined);
  const auditIds = [candidateRow.id];
  if (matchRecord?.id) auditIds.push(matchRecord.id);

  const placeholders = auditIds.map((_, index) => `$${index + 1}`).join(", ");
  const auditResult = await pool.query(
    `
      SELECT id, event_ts, actor_type, actor_id, entity_type, entity_id, event_type, details
      FROM audit_log
      WHERE entity_id IN (${placeholders})
      ORDER BY event_ts DESC NULLS LAST
      LIMIT 50
    `,
    auditIds
  );

  const listItem = mapRowToListItem(candidateRow);

  return {
    candidate: {
      ...listItem,
      reason: candidateRow.reason,
      estimatedShipping: toNumber(candidateRow.estimated_shipping),
      estimatedCogs: toNumber(candidateRow.estimated_cogs),
      estimatedFees: candidateRow.estimated_fees,
      supplierSnapshotId: candidateRow.supplier_snapshot_id,
      marketPriceSnapshotId: candidateRow.market_price_snapshot_id,
      listingMarketplaceKey: candidateRow.listing_marketplace_key ?? null,
      listingQuantity: toNumber(candidateRow.listing_quantity),
      listingIdempotencyKey: candidateRow.listing_idempotency_key ?? null,
      listingPayload: asObject(candidateRow.listing_payload),
      listingResponse: asObject(candidateRow.listing_response),
      listingCreatedAt: toIsoString(candidateRow.listing_created_at),
      listingUpdatedAt: toIsoString(candidateRow.listing_updated_at),
    },
    supplierSnapshot: mapSupplierSnapshot(supplierResult.rows[0] as QueryResultRow | undefined),
    marketplaceSnapshot: mapMarketplaceSnapshot(marketplaceResult.rows[0] as QueryResultRow | undefined),
    match: matchRecord,
    auditHistory: auditResult.rows.map((row) => mapAuditEntry(row as QueryResultRow)),
  };
}

export function getSupplierImageUrl(detail: CandidateDetail | null): string | null {
  if (!detail?.supplierSnapshot) return null;
  return extractImageUrl(detail.supplierSnapshot.images, detail.supplierSnapshot.rawPayload);
}
