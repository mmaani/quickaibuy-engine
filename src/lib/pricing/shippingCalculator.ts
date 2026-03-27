import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getShippingConfig } from "@/lib/pricing/shippingConfig";
import { inferShippingFromEvidence, type SupplierShippingProfile } from "@/lib/pricing/shippingInference";

export type ShippingResolutionMode =
  | "EXACT_QUOTE"
  | "SUPPLIER_DEFAULT"
  | "INFERRED_STRONG"
  | "INFERRED_WEAK"
  | "FALLBACK_DEFAULT"
  | "UNRESOLVED";

export type ShippingResolutionError =
  | "MISSING_SHIPPING_INTELLIGENCE"
  | "STALE_SHIPPING_QUOTE"
  | "SHIPPING_DELIVERY_WINDOW_TOO_LONG"
  | "SHIPPING_COST_UNRESOLVED"
  | "SHIPPING_CONFIDENCE_TOO_LOW"
  | null;

export type ShippingResolution = {
  resolvedOriginCountry: string | null;
  destinationCountry: string;
  shippingCostUsd: number;
  shippingReserveUsd: number;
  deliveryEstimateMinDays: number | null;
  deliveryEstimateMaxDays: number | null;
  sourceConfidence: number | null;
  resolutionMode: ShippingResolutionMode;
  stale: boolean;
  quoteAgeHours: number | null;
  sourceType: string | null;
  errorReason: ShippingResolutionError;
};

type SupplierShippingQuoteRow = {
  originCountry: string | null;
  destinationCountry: string;
  shippingCost: string;
  currency: string;
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  confidence: string | null;
  sourceType: string | null;
  lastVerifiedAt: Date | string | null;
  serviceLevel: string;
};

type ShippingProfileRow = {
  sampleCount: number;
  averageCostUsd: string | null;
  averageMinDays: string | null;
  averageMaxDays: string | null;
  dominantOriginCountry: string | null;
  historicalConfidence: string | null;
  preferredMethods: unknown;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function resolveShippingCost(input: {
  supplierKey: string;
  supplierProductId: string;
  destinationCountry: string;
  shippingEstimates?: unknown;
  rawPayload?: unknown;
}): Promise<ShippingResolution> {
  const config = getShippingConfig();
  const destinationCountry = input.destinationCountry.toUpperCase();
  const now = new Date();

  const rowsResult = await db.execute<SupplierShippingQuoteRow>(sql`
    SELECT
      origin_country AS "originCountry",
      destination_country AS "destinationCountry",
      shipping_cost::text AS "shippingCost",
      currency,
      estimated_min_days AS "estimatedMinDays",
      estimated_max_days AS "estimatedMaxDays",
      confidence::text AS "confidence",
      source_type AS "sourceType",
      last_verified_at AS "lastVerifiedAt",
      service_level AS "serviceLevel"
    FROM supplier_shipping_quotes
    WHERE lower(supplier_key) = lower(${input.supplierKey})
      AND supplier_product_id = ${input.supplierProductId}
      AND upper(destination_country) IN (${destinationCountry}, 'DEFAULT')
    ORDER BY
      CASE WHEN upper(destination_country) = ${destinationCountry} THEN 0 ELSE 1 END,
      CASE WHEN upper(service_level) = 'STANDARD' THEN 0 ELSE 1 END,
      last_verified_at DESC
    LIMIT 1
  `);

  const profileResult = await db.execute<ShippingProfileRow>(sql`
    SELECT
      count(*)::int AS "sampleCount",
      avg(shipping_cost)::text AS "averageCostUsd",
      avg(estimated_min_days)::text AS "averageMinDays",
      avg(estimated_max_days)::text AS "averageMaxDays",
      (
        SELECT origin_country
        FROM supplier_shipping_quotes sq2
        WHERE lower(sq2.supplier_key) = lower(${input.supplierKey})
          AND upper(sq2.destination_country) = ${destinationCountry}
          AND sq2.origin_country IS NOT NULL
        GROUP BY origin_country
        ORDER BY count(*) DESC, origin_country ASC
        LIMIT 1
      ) AS "dominantOriginCountry",
      avg(confidence)::text AS "historicalConfidence",
      COALESCE(
        jsonb_agg(DISTINCT source_type) FILTER (WHERE source_type IS NOT NULL),
        '[]'::jsonb
      ) AS "preferredMethods"
    FROM supplier_shipping_quotes
    WHERE lower(supplier_key) = lower(${input.supplierKey})
      AND upper(destination_country) = ${destinationCountry}
      AND confidence >= 0.45
      AND source_type NOT IN ('fallback_seed', 'shipping_fallback_default')
  `);

  const profileRow = profileResult.rows?.[0];
  const profile: SupplierShippingProfile | null =
    profileRow && Number(profileRow.sampleCount) > 0
      ? {
          supplierKey: input.supplierKey,
          destinationCountry,
          sampleCount: Number(profileRow.sampleCount),
          averageCostUsd: toNum(profileRow.averageCostUsd),
          averageMinDays: toNum(profileRow.averageMinDays),
          averageMaxDays: toNum(profileRow.averageMaxDays),
          dominantOriginCountry: profileRow.dominantOriginCountry,
          historicalConfidence: toNum(profileRow.historicalConfidence),
          preferredMethods: Array.isArray(profileRow.preferredMethods)
            ? profileRow.preferredMethods.map((value) => String(value))
            : [],
          consistencyScore: Number(profileRow.sampleCount) >= 4 ? 0.92 : Number(profileRow.sampleCount) >= 2 ? 0.78 : 0.62,
        }
      : null;

  const row = rowsResult.rows?.[0];
  const candidateCost = row ? toNum(row.shippingCost) : null;
  const inferred = inferShippingFromEvidence({
    supplierKey: input.supplierKey,
    destinationCountry,
    shippingEstimates: input.shippingEstimates,
    rawPayload: input.rawPayload,
    profile,
  });

  let resolutionMode: ShippingResolutionMode = "UNRESOLVED";
  let baseShippingUsd: number | null = null;
  let confidence: number | null = null;
  let sourceType: string | null = null;
  let minDays: number | null = null;
  let maxDays: number | null = null;
  let originCountry: string | null = null;
  let stale = false;
  let quoteAgeHours: number | null = null;

  if (row && row.currency.toUpperCase() === "USD" && candidateCost != null && candidateCost >= 0) {
    baseShippingUsd = candidateCost;
    resolutionMode = row.destinationCountry.toUpperCase() === destinationCountry ? "EXACT_QUOTE" : "SUPPLIER_DEFAULT";
    confidence = toNum(row.confidence);
    sourceType = row.sourceType ?? "supplier_quote";
    minDays = row.estimatedMinDays;
    maxDays = row.estimatedMaxDays;
    originCountry = row.originCountry;
    const verifiedAt = toDate(row.lastVerifiedAt);
    if (verifiedAt) {
      quoteAgeHours = round2((now.getTime() - verifiedAt.getTime()) / (1000 * 60 * 60));
      stale = quoteAgeHours > config.maxShippingQuoteAgeHours;
    } else {
      stale = true;
    }
  }

  const exactQuoteWeak =
    baseShippingUsd != null &&
    !stale &&
    confidence != null &&
    confidence < config.minShippingConfidence &&
    inferred.shippingCostUsd != null &&
    inferred.confidence != null &&
    inferred.confidence > confidence;

  if (baseShippingUsd == null || exactQuoteWeak) {
    baseShippingUsd = inferred.shippingCostUsd;
    resolutionMode = inferred.mode;
    confidence = inferred.confidence;
    sourceType = inferred.sourceType;
    minDays = inferred.estimatedMinDays;
    maxDays = inferred.estimatedMaxDays;
    originCountry = inferred.originCountry;
    stale = false;
    quoteAgeHours = 0;
  }

  let errorReason: ShippingResolutionError = null;

  if (baseShippingUsd == null) {
    return {
      resolvedOriginCountry: originCountry,
      destinationCountry,
      shippingCostUsd: 0,
      shippingReserveUsd: 0,
      deliveryEstimateMinDays: minDays,
      deliveryEstimateMaxDays: maxDays,
      sourceConfidence: confidence,
      resolutionMode,
      stale,
      quoteAgeHours,
      sourceType,
      errorReason: "MISSING_SHIPPING_INTELLIGENCE",
    };
  }

  if (stale) errorReason = "STALE_SHIPPING_QUOTE";
  if (!errorReason && confidence != null && confidence < config.minShippingConfidence && resolutionMode !== "INFERRED_STRONG") {
    errorReason = "SHIPPING_CONFIDENCE_TOO_LOW";
  }
  if (!errorReason && maxDays != null && maxDays > config.maxAllowedDeliveryDaysForV1) {
    errorReason = "SHIPPING_DELIVERY_WINDOW_TOO_LONG";
  }

  const reservePctMultiplier =
    resolutionMode === "INFERRED_STRONG" ? 1.25 : resolutionMode === "INFERRED_WEAK" ? 1.45 : 1;
  const shippingReserveUsd = Math.max(
    config.minimumShippingReserveUsd,
    round2(((baseShippingUsd * config.shippingCostBufferPct) / 100) * reservePctMultiplier)
  );

  return {
    resolvedOriginCountry: originCountry,
    destinationCountry,
    shippingCostUsd: round2(baseShippingUsd),
    shippingReserveUsd,
    deliveryEstimateMinDays: minDays,
    deliveryEstimateMaxDays: maxDays,
    sourceConfidence: confidence,
    resolutionMode,
    stale,
    quoteAgeHours,
    sourceType,
    errorReason,
  };
}
