import { db } from "@/lib/db";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { sql } from "drizzle-orm";
import { getPriceGuardThresholds, type PriceGuardThresholds } from "./priceGuardConfig";
import { getProfitAssumptions, type ProfitAssumptions } from "./profitAssumptions";
import { evaluateProfitHardGate } from "./hardProfitGate";
import {
  extractAvailabilityFromRawPayload,
  normalizeAvailabilitySignal,
  type AvailabilitySignal,
} from "@/lib/products/supplierAvailability";

export type PriceGuardDecision = "ALLOW" | "BLOCK";
export type PriceGuardReasonSeverity = "BLOCK";

export type PriceGuardReasonCode =
  | "MISSING_SUPPLIER_PRICE"
  | "MISSING_MARKETPLACE_PRICE"
  | "MISSING_FEE_ASSUMPTIONS"
  | "MISSING_SHIPPING_DATA"
  | "SUPPLIER_SNAPSHOT_AGE_UNAVAILABLE"
  | "MARKETPLACE_SNAPSHOT_AGE_UNAVAILABLE"
  | "STALE_SUPPLIER_SNAPSHOT"
  | "STALE_MARKETPLACE_SNAPSHOT"
  | "SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE"
  | "SUPPLIER_DRIFT_DATA_UNAVAILABLE"
  | "SUPPLIER_OUT_OF_STOCK"
  | "SUPPLIER_LOW_STOCK"
  | "SUPPLIER_AVAILABILITY_UNKNOWN"
  | "SUPPLIER_AVAILABILITY_LOW_CONFIDENCE"
  | "INCOMPLETE_ECONOMICS"
  | "PROFIT_BELOW_MINIMUM"
  | "MARGIN_BELOW_MINIMUM"
  | "ROI_BELOW_MINIMUM";

export type PriceGuardReason = {
  code: PriceGuardReasonCode;
  severity: PriceGuardReasonSeverity;
  message: string;
  meta?: Record<string, unknown>;
};

export type PriceGuardMetrics = {
  profit: number | null;
  margin_pct: number | null;
  roi_pct: number | null;
  supplier_price: number | null;
  marketplace_price: number | null;
  shipping_cost: number | null;
  estimated_fees: number | null;
  estimated_cogs: number | null;
  cost_components: Record<string, number> | null;
  supplier_price_drift_pct: number | null;
  supplier_snapshot_age_hours: number | null;
  availability_signal: AvailabilitySignal;
  availability_confidence: number | null;
  availability_snapshot_age_hours: number | null;
  marketplace_snapshot_age_hours: number | null;
  drift_hook: {
    available: boolean;
    tolerance_pct: number;
    required: boolean;
  };
};

export type PriceGuardResult = {
  allow: boolean;
  decision: PriceGuardDecision;
  reasons: string[];
  reasonDetails: PriceGuardReason[];
  reasonSummary: string;
  metrics: PriceGuardMetrics;
  thresholds: PriceGuardThresholds;
  economics_hard_pass: boolean;
  economics_block_reason: string | null;
  economics_verified_at: string;
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

  originalSupplierPrice: string | null;
  originalSupplierSnapshotTs: Date | string | null;
  originalMarketPrice: string | null;
  originalMarketShipping: string | null;

  latestSupplierPrice: string | null;
  latestSupplierSnapshotTs: Date | string | null;
  latestSupplierAvailabilityStatus: string | null;
  latestSupplierRawPayload: unknown;

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
  payoutReservePct: number | null;
  paymentReservePct: number | null;
  fxReservePct: number | null;
  shippingVariancePct: number | null;
} {
  const obj = asObject(value);
  if (!obj) {
    return {
      feePct: null,
      otherCostUsd: null,
      feeUsd: null,
      payoutReservePct: null,
      paymentReservePct: null,
      fxReservePct: null,
      shippingVariancePct: null,
    };
  }

  return {
    feePct: toNumber(obj.feePct),
    otherCostUsd: toNumber(obj.otherCostUsd),
    feeUsd: toNumber(obj.feeUsd),
    payoutReservePct: toNumber(obj.payoutReservePct),
    paymentReservePct: toNumber(obj.paymentReservePct),
    fxReservePct: toNumber(obj.fxReservePct),
    shippingVariancePct: toNumber(obj.shippingVariancePct),
  };
}

function buildAssumptionsFromStoredFees(
  marketplaceKey: string,
  feeAssumptions: ReturnType<typeof extractFeeAssumptions>
): ProfitAssumptions {
  const defaults = getProfitAssumptions({ marketplaceKey });
  return {
    ...defaults,
    ebayFeeRatePct: feeAssumptions.feePct ?? defaults.ebayFeeRatePct,
    payoutReservePct: feeAssumptions.payoutReservePct ?? defaults.payoutReservePct,
    paymentReservePct: feeAssumptions.paymentReservePct ?? defaults.paymentReservePct,
    fxReservePct: feeAssumptions.fxReservePct ?? defaults.fxReservePct,
    shippingVariancePct: feeAssumptions.shippingVariancePct ?? defaults.shippingVariancePct,
    fixedCostUsd: feeAssumptions.otherCostUsd ?? defaults.fixedCostUsd,
  };
}

function computePctChange(original: number | null, latest: number | null): number | null {
  if (original == null || latest == null || original <= 0) return null;
  return round2(((latest - original) / original) * 100);
}

function decideFromReasons(reasonDetails: PriceGuardReason[]): PriceGuardDecision {
  return reasonDetails.length > 0 ? "BLOCK" : "ALLOW";
}

function addReason(
  reasons: PriceGuardReason[],
  reason: PriceGuardReason
): void {
  if (!reasons.some((existing) => existing.code === reason.code)) {
    reasons.push(reason);
  }
}

function assumptionsLookDeterministic(assumptions: ProfitAssumptions): boolean {
  return (
    Number.isFinite(assumptions.ebayFeeRatePct) &&
    assumptions.ebayFeeRatePct >= 0 &&
    assumptions.ebayFeeRatePct <= 100 &&
    Number.isFinite(assumptions.payoutReservePct) &&
    assumptions.payoutReservePct >= 0 &&
    assumptions.payoutReservePct <= 100 &&
    Number.isFinite(assumptions.paymentReservePct) &&
    assumptions.paymentReservePct >= 0 &&
    assumptions.paymentReservePct <= 100 &&
    Number.isFinite(assumptions.fxReservePct) &&
    assumptions.fxReservePct >= 0 &&
    assumptions.fxReservePct <= 100 &&
    Number.isFinite(assumptions.shippingVariancePct) &&
    assumptions.shippingVariancePct >= 0 &&
    assumptions.shippingVariancePct <= 100 &&
    Number.isFinite(assumptions.fixedCostUsd) &&
    assumptions.fixedCostUsd >= 0
  );
}

function buildReasonSummary(reasonDetails: PriceGuardReason[], decision: PriceGuardDecision): string {
  if (!reasonDetails.length) return `${decision}: economics and safety checks passed`;
  return `${decision}: ${reasonDetails
    .slice(0, 3)
    .map((reason) => reason.code)
    .join(", ")}`;
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

      ps.price_min::text AS "originalSupplierPrice",
      ps.snapshot_ts AS "originalSupplierSnapshotTs",

      mp.price::text AS "originalMarketPrice",
      mp.shipping_price::text AS "originalMarketShipping",

      latest_ps.price_min::text AS "latestSupplierPrice",
      latest_ps.snapshot_ts AS "latestSupplierSnapshotTs",
      latest_ps.availability_status AS "latestSupplierAvailabilityStatus",
      latest_ps.raw_payload AS "latestSupplierRawPayload",

      latest_mp.price::text AS "latestMarketPrice",
      latest_mp.shipping_price::text AS "latestMarketShipping",
      latest_mp.snapshot_ts AS "latestMarketSnapshotTs"
    FROM profitable_candidates pc
    LEFT JOIN products_raw ps ON ps.id = pc.supplier_snapshot_id
    LEFT JOIN marketplace_prices mp ON mp.id = pc.market_price_snapshot_id
    LEFT JOIN LATERAL (
      SELECT pr.price_min, pr.snapshot_ts, pr.availability_status, pr.raw_payload
      FROM products_raw pr
      WHERE pr.supplier_key = pc.supplier_key
        AND pr.supplier_product_id = pc.supplier_product_id
      ORDER BY pr.snapshot_ts DESC, pr.id DESC
      LIMIT 1
    ) latest_ps ON TRUE
    LEFT JOIN LATERAL (
      SELECT mp2.price, mp2.shipping_price, mp2.snapshot_ts
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

  const shippingCost =
    toNumber(row.estimatedShipping) ?? null;

  const assumptions = buildAssumptionsFromStoredFees(row.marketplaceKey, feeAssumptions);

  const hardGate = evaluateProfitHardGate({
    marketplaceKey: row.marketplaceKey,
    supplierPriceUsd: latestSupplierPrice,
    marketplacePriceUsd: latestMarketPrice,
    shippingCostUsd: shippingCost,
    assumptions,
    assumptionsDeterministic: assumptionsLookDeterministic(assumptions),
    supplierSnapshotAgeHours: hoursBetween(now, toDate(row.latestSupplierSnapshotTs)),
    marketplaceSnapshotAgeHours: hoursBetween(now, toDate(row.latestMarketSnapshotTs)),
    thresholds,
  });
  const economics = hardGate.economics;

  const estimatedFees = economics?.estimatedFeesUsd ?? feeAssumptions.feeUsd ?? null;
  const estimatedCogs = economics?.estimatedCogsUsd ?? null;
  const recomputedProfit = economics?.estimatedProfitUsd ?? null;
  const recomputedMarginPct = economics?.marginPct ?? null;
  const recomputedRoiPct = economics?.roiPct ?? null;

  const supplierSnapshotAgeHours = hoursBetween(now, toDate(row.latestSupplierSnapshotTs));
  const inferredAvailability = extractAvailabilityFromRawPayload({
    availabilityStatus: row.latestSupplierAvailabilityStatus,
    rawPayload: row.latestSupplierRawPayload,
  });
  const availabilitySignal = normalizeAvailabilitySignal(inferredAvailability.signal);
  const availabilityConfidence = inferredAvailability.confidence;
  const marketplaceSnapshotAgeHours = hoursBetween(now, toDate(row.latestMarketSnapshotTs));
  const supplierPriceDriftPct = computePctChange(originalSupplierPrice, latestSupplierPrice);

  const reasonDetails: PriceGuardReason[] = [];

  if (latestSupplierPrice == null || latestSupplierPrice <= 0) {
    addReason(reasonDetails, {
      code: "MISSING_SUPPLIER_PRICE",
      severity: "BLOCK",
      message: "Supplier price is missing or invalid.",
    });
  }

  if (latestMarketPrice == null || latestMarketPrice <= 0) {
    addReason(reasonDetails, {
      code: "MISSING_MARKETPLACE_PRICE",
      severity: "BLOCK",
      message: "Marketplace price is missing or invalid.",
    });
  }

  if (!assumptionsLookDeterministic(assumptions) || estimatedFees == null) {
    addReason(reasonDetails, {
      code: "MISSING_FEE_ASSUMPTIONS",
      severity: "BLOCK",
      message: "Fee assumptions are incomplete for deterministic recomputation.",
    });
  }

  if (shippingCost == null) {
    addReason(reasonDetails, {
      code: "MISSING_SHIPPING_DATA",
      severity: "BLOCK",
      message: "Shipping data is required but missing.",
    });
  }

  if (supplierSnapshotAgeHours == null) {
    addReason(reasonDetails, {
      code: "SUPPLIER_SNAPSHOT_AGE_UNAVAILABLE",
      severity: "BLOCK",
      message: "Supplier snapshot age is unavailable for fail-closed validation.",
    });
  } else if (supplierSnapshotAgeHours > thresholds.maxSupplierSnapshotAgeHours) {
    addReason(reasonDetails, {
      code: "STALE_SUPPLIER_SNAPSHOT",
      severity: "BLOCK",
      message: "Supplier snapshot is stale and should be reviewed.",
      meta: {
        ageHours: supplierSnapshotAgeHours,
        maxAgeHours: thresholds.maxSupplierSnapshotAgeHours,
      },
    });
  }

  if (marketplaceSnapshotAgeHours == null) {
    addReason(reasonDetails, {
      code: "MARKETPLACE_SNAPSHOT_AGE_UNAVAILABLE",
      severity: "BLOCK",
      message: "Marketplace snapshot age is unavailable for fail-closed validation.",
    });
  } else if (marketplaceSnapshotAgeHours > thresholds.maxMarketplaceSnapshotAgeHours) {
    addReason(reasonDetails, {
      code: "STALE_MARKETPLACE_SNAPSHOT",
      severity: "BLOCK",
      message: "Marketplace snapshot is stale and should be reviewed.",
      meta: {
        ageHours: marketplaceSnapshotAgeHours,
        maxAgeHours: thresholds.maxMarketplaceSnapshotAgeHours,
      },
    });
  }

  if (supplierPriceDriftPct != null) {
    if (Math.abs(supplierPriceDriftPct) > thresholds.maxSupplierDriftPct) {
      addReason(reasonDetails, {
        code: "SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE",
        severity: "BLOCK",
        message: "Supplier price drift exceeds configured tolerance.",
        meta: {
          driftPct: supplierPriceDriftPct,
          tolerancePct: thresholds.maxSupplierDriftPct,
        },
      });
    }
  } else if (thresholds.requireSupplierDriftData) {
    addReason(reasonDetails, {
      code: "SUPPLIER_DRIFT_DATA_UNAVAILABLE",
      severity: "BLOCK",
      message: "Supplier drift data is unavailable but required for this guard profile.",
      meta: {
        originalSupplierPrice,
        latestSupplierPrice,
      },
    });
  }

  // Supplier availability is a v1 conservative safety hook: unsafe blocks, uncertain requires manual review.
  if (availabilitySignal === "OUT_OF_STOCK") {
    addReason(reasonDetails, {
      code: "SUPPLIER_OUT_OF_STOCK",
      severity: "BLOCK",
      message: "Supplier indicates out of stock.",
      meta: { availabilitySignal, availabilityConfidence },
    });
  } else if (availabilitySignal === "LOW_STOCK") {
    addReason(reasonDetails, {
      code: "SUPPLIER_LOW_STOCK",
      severity: "BLOCK",
      message: "Supplier stock appears limited and requires manual review.",
      meta: { availabilitySignal, availabilityConfidence },
    });
  } else if (availabilitySignal === "UNKNOWN") {
    addReason(reasonDetails, {
      code: "SUPPLIER_AVAILABILITY_UNKNOWN",
      severity: "BLOCK",
      message: "Supplier availability is unknown and cannot auto-pass.",
      meta: { availabilitySignal, availabilityConfidence },
    });
  }

  if (availabilityConfidence != null && availabilityConfidence < 0.5) {
    addReason(reasonDetails, {
      code: "SUPPLIER_AVAILABILITY_LOW_CONFIDENCE",
      severity: "BLOCK",
      message: "Supplier availability confidence is low.",
      meta: { availabilitySignal, availabilityConfidence, minConfidence: 0.5 },
    });
  }

  if (recomputedProfit == null) {
    addReason(reasonDetails, {
      code: "INCOMPLETE_ECONOMICS",
      severity: "BLOCK",
      message: "Economics could not be fully recomputed with deterministic assumptions.",
    });
  } else if (recomputedProfit < thresholds.minProfitUsd) {
    addReason(reasonDetails, {
      code: "PROFIT_BELOW_MINIMUM",
      severity: "BLOCK",
      message: "Recomputed profit is below minimum threshold.",
      meta: {
        minProfitUsd: thresholds.minProfitUsd,
        recomputedProfit,
      },
    });
  }

  if (recomputedMarginPct != null && recomputedMarginPct < thresholds.minMarginPct) {
    addReason(reasonDetails, {
      code: "MARGIN_BELOW_MINIMUM",
      severity: "BLOCK",
      message: "Recomputed margin is below minimum threshold.",
      meta: {
        minMarginPct: thresholds.minMarginPct,
        recomputedMarginPct,
      },
    });
  }

  if (recomputedRoiPct != null && recomputedRoiPct < thresholds.minRoiPct) {
    addReason(reasonDetails, {
      code: "ROI_BELOW_MINIMUM",
      severity: "BLOCK",
      message: "Recomputed ROI is below minimum threshold.",
      meta: {
        minRoiPct: thresholds.minRoiPct,
        recomputedRoiPct,
      },
    });
  }

  for (const reasonCode of hardGate.reasonCodes) {
    addReason(reasonDetails, {
      code: reasonCode,
      severity: "BLOCK",
      message: reasonCode,
    });
  }

  const decision = decideFromReasons(reasonDetails);
  const reasonSummary = buildReasonSummary(reasonDetails, decision);

  return {
    allow: decision === "ALLOW",
    decision,
    reasons: reasonDetails.map((reason) => reason.code),
    reasonDetails,
    reasonSummary,
    metrics: {
      profit: recomputedProfit,
      margin_pct: recomputedMarginPct,
      roi_pct: recomputedRoiPct,
      supplier_price: latestSupplierPrice,
      marketplace_price: latestMarketPrice,
      shipping_cost: shippingCost,
      estimated_fees: estimatedFees,
      estimated_cogs: estimatedCogs,
      cost_components: economics?.costs ?? null,
      supplier_price_drift_pct: supplierPriceDriftPct,
      supplier_snapshot_age_hours: supplierSnapshotAgeHours,
      availability_signal: availabilitySignal,
      availability_confidence: availabilityConfidence,
      availability_snapshot_age_hours: supplierSnapshotAgeHours,
      marketplace_snapshot_age_hours: marketplaceSnapshotAgeHours,
      drift_hook: {
        available: supplierPriceDriftPct != null,
        tolerance_pct: thresholds.maxSupplierDriftPct,
        required: thresholds.requireSupplierDriftData,
      },
    },
    thresholds,
    economics_hard_pass: hardGate.allow,
    economics_block_reason: hardGate.blockReason,
    economics_verified_at: now.toISOString(),
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
