import { pool } from "@/lib/db";

export const REVIEW_ROUTE = "/admin/review";
export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED", "RECHECK", "LISTED", "EXPIRED"] as const;
export const REVIEW_ACTION_STATUSES = ["APPROVED", "REJECTED", "RECHECK"] as const;
export const LOW_MATCH_CONFIDENCE_THRESHOLD = 0.75;
export const HIGH_MARGIN_THRESHOLD = 80;
export const BLOCKING_RISK_FLAGS = new Set([
  "LOW_MATCH_CONFIDENCE",
  "MISSING_SHIPPING_ESTIMATE",
  "BRAND_OR_RESTRICTED_TITLE",
  "DUPLICATE_CANDIDATE_PATTERN",
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
  riskFlags: string[];
  blockingRiskFlags: string[];
  listingEligible: boolean;
  listingEligibilityReasons: string[];
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
  listing_title: string | null;
  listing_price: string | number | null;
  match_confidence: string | number | null;
  duplicate_count: string | number | null;
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
  const flags = new Set<string>((row.risk_flags ?? []).filter(Boolean));
  const confidence = toNumber(row.match_confidence);
  const estimatedShipping = toNumber(row.estimated_shipping);
  const marginPct = toNumber(row.margin_pct);
  const duplicateCount = toNumber(row.duplicate_count) ?? 1;
  const joinedTitle = `${row.supplier_title ?? ""} ${row.marketplace_title ?? ""}`.trim();

  if (confidence != null && confidence < LOW_MATCH_CONFIDENCE_THRESHOLD) {
    flags.add("LOW_MATCH_CONFIDENCE");
  }

  if (estimatedShipping == null || estimatedShipping <= 0) {
    flags.add("MISSING_SHIPPING_ESTIMATE");
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

  return Array.from(flags);
}

function computeListingEligibility(input: {
  decisionStatus: string;
  estimatedProfit: number | null;
  confidence: number | null;
  riskFlags: string[];
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
  const riskFlags = deriveRiskFlags(row);
  const eligibility = computeListingEligibility({
    decisionStatus: row.decision_status,
    estimatedProfit,
    confidence: matchConfidence,
    riskFlags,
  });

  return {
    id: row.id,
    supplierKey: row.supplier_key,
    supplierProductId: row.supplier_product_id,
    marketplaceKey: row.marketplace_key,
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
    riskFlags,
    blockingRiskFlags: eligibility.blockingRiskFlags,
    listingEligible: eligibility.listingEligible,
    listingEligibilityReasons: eligibility.listingEligibilityReasons,
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
        FROM profitable_candidates
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
    values.push(filters.marketplace);
    conditions.push(`pc.marketplace_key = $${values.length}`);
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
        pc.estimated_cogs,
        pc.risk_flags,
        pc.supplier_snapshot_id,
        pc.market_price_snapshot_id,
        pr.title AS supplier_title,
        mp.matched_title AS marketplace_title,
        ${listingSelectClause}
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
      ${listingJoinClause}
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
  };
}

function mapMarketplaceSnapshot(row: QueryResultRow | undefined): MarketplaceSnapshot | null {
  if (!row) return null;

  return {
    id: String(row.id),
    marketplaceKey: String(row.marketplace_key),
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
        pc.estimated_cogs,
        pc.risk_flags,
        pc.supplier_snapshot_id,
        pc.market_price_snapshot_id,
        pr.title AS supplier_title,
        mp.matched_title AS marketplace_title,
        ${listingSelectClause}
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
      ${listingJoinClause}
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
