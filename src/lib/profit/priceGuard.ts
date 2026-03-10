import { db } from "@/lib/db";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { sql } from "drizzle-orm";
import { getPriceGuardThresholds, type PriceGuardThresholds } from "./priceGuardConfig";

export type PriceGuardDecision = "ALLOW" | "BLOCK" | "MANUAL_REVIEW";

export type PriceGuardMetrics = {
  profit: number | null;
  margin_pct: number | null;
  roi_pct: number | null;
  supplier_price: number | null;
  marketplace_price: number | null;
  shipping_cost: number | null;
  estimated_fees: number | null;
  estimated_cogs: number | null;
  supplier_price_drift_pct: number | null;
  supplier_snapshot_age_hours: number | null;
  marketplace_snapshot_age_hours: number | null;
};

export type PriceGuardResult = {
  allow: boolean;
  decision: PriceGuardDecision;
  reasons: string[];
  metrics: PriceGuardMetrics;
  thresholds: PriceGuardThresholds;
  context: {
    candidateId: string;
    listingId: string | null;
    mode: "publish" | "order";
    supplierKey: string;
    supplierProductId: string;
    marketplaceKey: string;
    marketplaceListingId: string;
    approvedDecisionStatus: string | null;
    listingEligible: boolean | null;
  };
};

type PriceGuardRow = {
  candidateId: string;
  supplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  decisionStatus: string | null;
  listingEligible: boolean | null;

  estimatedFees: unknown;
  estimatedShipping: string | null;
  estimatedCogs: string | null;
  estimatedProfit: string | null;
  marginPct: string | null;
  roiPct: string | null;

  originalSupplierSnapshotId: string | null;
  originalMarketSnapshotId: string | null;
  originalSupplierPrice: string | null;
  originalSupplierSnapshotTs: Date | string | null;
  originalMarketPrice: string | null;
  originalMarketShipping: string | null;
  originalMarketSnapshotTs: Date | string | null;

  latestSupplierSnapshotId: string | null;
  latestSupplierPrice: string | null;
  latestSupplierSnapshotTs: Date | string | null;

  latestMarketSnapshotId: string | null;
  latestMarketPrice: string | null;
  latestMarketShipping: string | null;
  latestMarketSnapshotTs: Date | string | null;
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hoursBetween(now: Date, earlier: Date | null): number | null {
  if (!earlier) return null;
  return round2((now.getTime() - earlier.getTime()) / (1000 * 60 * 60));
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractFeeAssumptions(value: unknown): {
  feePct: number | null;
  otherCostUsd: number | null;
  feeUsd: number | null;
} {
  const obj = asObject(value);
  if (!obj) {
    return {
      feePct: null,
      otherCostUsd: null,
      feeUsd: null,
    };
  }

  return {
    feePct: toNumber(obj.feePct),
    otherCostUsd: toNumber(obj.otherCostUsd),
    feeUsd: toNumber(obj.feeUsd),
  };
}

function computePctChange(original: number | null, latest: number | null): number | null {
  if (original == null || latest == null || original <= 0) return null;
  return round2(((latest - original) / original) * 100);
}

function decideFromReasons(hardBlockReasons: string[], reviewReasons: string[]): PriceGuardDecision {
  if (hardBlockReasons.length > 0) return "BLOCK";
  if (reviewReasons.length > 0) return "MANUAL_REVIEW";
  return "ALLOW";
}

export async function validateProfitSafety(input: {
  candidateId: string;
  listingId?: string | null;
  mode?: "publish" | "order";
  now?: Date;
}): Promise<PriceGuardResult> {
  const candidateId = String(input.candidateId || "").trim();
  if (!candidateId) {
    throw new Error("validateProfitSafety requires candidateId");
  }

  const mode = input.mode ?? "publish";
  const now = input.now ?? new Date();
  const thresholds = getPriceGuardThresholds();

  const result = await db.execute<PriceGuardRow>(sql`
    SELECT
      pc.id AS "candidateId",
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      pc.marketplace_key AS "marketplaceKey",
      pc.marketplace_listing_id AS "marketplaceListingId",
      pc.decision_status AS "decisionStatus",
      pc.listing_eligible AS "listingEligible",

      pc.estimated_fees AS "estimatedFees",
      pc.estimated_shipping::text AS "estimatedShipping",
      pc.estimated_cogs::text AS "estimatedCogs",
      pc.estimated_profit::text AS "estimatedProfit",
      pc.margin_pct::text AS "marginPct",
      pc.roi_pct::text AS "roiPct",

      ps.id AS "originalSupplierSnapshotId",
      ps.price_min::text AS "originalSupplierPrice",
      ps.snapshot_ts AS "originalSupplierSnapshotTs",

      mp.id AS "originalMarketSnapshotId",
      mp.price::text AS "originalMarketPrice",
      mp.shipping_price::text AS "originalMarketShipping",
      mp.snapshot_ts AS "originalMarketSnapshotTs",

      latest_ps.id AS "latestSupplierSnapshotId",
      latest_ps.price_min::text AS "latestSupplierPrice",
      latest_ps.snapshot_ts AS "latestSupplierSnapshotTs",

      latest_mp.id AS "latestMarketSnapshotId",
      latest_mp.price::text AS "latestMarketPrice",
      latest_mp.shipping_price::text AS "latestMarketShipping",
      latest_mp.snapshot_ts AS "latestMarketSnapshotTs"
    FROM profitable_candidates pc
    LEFT JOIN products_raw ps
      ON ps.id = pc.supplier_snapshot_id
    LEFT JOIN marketplace_prices mp
      ON mp.id = pc.market_price_snapshot_id
    LEFT JOIN LATERAL (
      SELECT
        pr.id,
        pr.price_min,
        pr.snapshot_ts
      FROM products_raw pr
      WHERE pr.supplier_key = pc.supplier_key
        AND pr.supplier_product_id = pc.supplier_product_id
      ORDER BY pr.snapshot_ts DESC, pr.id DESC
      LIMIT 1
    ) latest_ps ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        mp2.id,
        mp2.price,
        mp2.shipping_price,
        mp2.snapshot_ts
      FROM marketplace_prices mp2
      WHERE LOWER(mp2.marketplace_key) = LOWER(pc.marketplace_key)
        AND mp2.marketplace_listing_id = pc.marketplace_listing_id
      ORDER BY mp2.snapshot_ts DESC, mp2.id DESC
      LIMIT 1
    ) latest_mp ON TRUE
    WHERE pc.id = ${candidateId}
    LIMIT 1
  `);

  const row = result.rows?.[0];
  if (!row) {
    throw new Error(`PriceGuard candidate not found: ${candidateId}`);
  }

  const feeAssumptions = extractFeeAssumptions(row.estimatedFees);

  const originalSupplierPrice = toNumber(row.originalSupplierPrice);
  const latestSupplierPrice = toNumber(row.latestSupplierPrice) ?? originalSupplierPrice;

  const originalMarketPrice = toNumber(row.originalMarketPrice);
  const latestMarketPrice = toNumber(row.latestMarketPrice) ?? originalMarketPrice;

  const originalMarketShipping = toNumber(row.originalMarketShipping);
  const latestMarketShipping = toNumber(row.latestMarketShipping);

  const shippingCost =
    toNumber(row.estimatedShipping) ??
    latestMarketShipping ??
    originalMarketShipping ??
    null;

  const feePct = feeAssumptions.feePct;
  const otherCostUsd = feeAssumptions.otherCostUsd ?? 0;

  const estimatedFees =
    latestMarketPrice != null && feePct != null
      ? round2((latestMarketPrice * feePct) / 100)
      : feeAssumptions.feeUsd;

  const estimatedCogs =
    latestSupplierPrice != null ? round2(latestSupplierPrice + otherCostUsd) : null;

  const recomputedProfit =
    latestMarketPrice != null &&
    estimatedFees != null &&
    estimatedCogs != null &&
    shippingCost != null
      ? round2(latestMarketPrice - estimatedFees - shippingCost - estimatedCogs)
      : null;

  const recomputedMarginPct =
    recomputedProfit != null && latestMarketPrice != null && latestMarketPrice > 0
      ? round2((recomputedProfit / latestMarketPrice) * 100)
      : null;

  const recomputedRoiPct =
    recomputedProfit != null && estimatedCogs != null && estimatedCogs > 0
      ? round2((recomputedProfit / estimatedCogs) * 100)
      : null;

  const supplierSnapshotAgeHours = hoursBetween(now, toDate(row.latestSupplierSnapshotTs));
  const marketplaceSnapshotAgeHours = hoursBetween(now, toDate(row.latestMarketSnapshotTs));
  const supplierPriceDriftPct = computePctChange(originalSupplierPrice, latestSupplierPrice);

  const hardBlockReasons: string[] = [];
  const reviewReasons: string[] = [];

  if (latestSupplierPrice == null || latestSupplierPrice <= 0) {
    hardBlockReasons.push("MISSING_SUPPLIER_PRICE");
  }

  if (latestMarketPrice == null || latestMarketPrice <= 0) {
    hardBlockReasons.push("MISSING_MARKETPLACE_PRICE");
  }

  if (estimatedFees == null) {
    reviewReasons.push("MISSING_FEE_ASSUMPTIONS");
  }

  if (shippingCost == null) {
    if (thresholds.requireShippingData) {
      reviewReasons.push("MISSING_SHIPPING_DATA");
    }
  }

  if (
    supplierSnapshotAgeHours != null &&
    supplierSnapshotAgeHours > thresholds.maxSupplierSnapshotAgeHours
  ) {
    reviewReasons.push("STALE_SUPPLIER_SNAPSHOT");
  }

  if (
    marketplaceSnapshotAgeHours != null &&
    marketplaceSnapshotAgeHours > thresholds.maxMarketplaceSnapshotAgeHours
  ) {
    reviewReasons.push("STALE_MARKETPLACE_SNAPSHOT");
  }

  if (
    supplierPriceDriftPct != null &&
    Math.abs(supplierPriceDriftPct) > thresholds.maxSupplierDriftPct
  ) {
    reviewReasons.push("SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE");
  }

  if (recomputedProfit == null) {
    reviewReasons.push("INCOMPLETE_ECONOMICS");
  } else if (recomputedProfit < thresholds.minProfitUsd) {
    hardBlockReasons.push("PROFIT_BELOW_MINIMUM");
  }

  if (recomputedMarginPct != null && recomputedMarginPct < thresholds.minMarginPct) {
    hardBlockReasons.push("MARGIN_BELOW_MINIMUM");
  }

  if (recomputedRoiPct != null && recomputedRoiPct < thresholds.minRoiPct) {
    hardBlockReasons.push("ROI_BELOW_MINIMUM");
  }

  const decision = decideFromReasons(hardBlockReasons, reviewReasons);
  const reasons = [...hardBlockReasons, ...reviewReasons];

  return {
    allow: decision === "ALLOW",
    decision,
    reasons,
    metrics: {
      profit: recomputedProfit,
      margin_pct: recomputedMarginPct,
      roi_pct: recomputedRoiPct,
      supplier_price: latestSupplierPrice,
      marketplace_price: latestMarketPrice,
      shipping_cost: shippingCost,
      estimated_fees: estimatedFees,
      estimated_cogs: estimatedCogs,
      supplier_price_drift_pct: supplierPriceDriftPct,
      supplier_snapshot_age_hours: supplierSnapshotAgeHours,
      marketplace_snapshot_age_hours: marketplaceSnapshotAgeHours,
    },
    thresholds,
    context: {
      candidateId: row.candidateId,
      listingId: input.listingId ?? null,
      mode,
      supplierKey: String(row.supplierKey || "").toLowerCase(),
      supplierProductId: row.supplierProductId,
      marketplaceKey: normalizeMarketplaceKey(row.marketplaceKey),
      marketplaceListingId: row.marketplaceListingId,
      approvedDecisionStatus: row.decisionStatus,
      listingEligible: row.listingEligible,
    },
  };
}
