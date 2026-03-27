function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPct(value: string | undefined, fallback: number): number {
  const parsed = toNumber(value, fallback);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export type ShippingConfig = {
  defaultPricingDestination: string;
  maxShippingQuoteAgeHours: number;
  maxAllowedDeliveryDaysForV1: number;
  minShippingConfidence: number;
  shippingCostBufferPct: number;
  minimumShippingReserveUsd: number;
  shippingCostDriftThresholdPct: number;
  shippingCostDriftThresholdUsd: number;
  repriceMinDeltaUsd: number;
  repriceMinDeltaPct: number;
  repriceCooldownHours: number;
  maxRepricesPerListingPerDay: number;
};

export function getShippingConfig(): ShippingConfig {
  return {
    defaultPricingDestination: String(process.env.DEFAULT_PRICING_DESTINATION ?? "US").toUpperCase(),
    maxShippingQuoteAgeHours: Math.max(1, toNumber(process.env.MAX_SHIPPING_QUOTE_AGE_HOURS, 72)),
    maxAllowedDeliveryDaysForV1: Math.max(1, toNumber(process.env.MAX_V1_DELIVERY_DAYS, 15)),
    minShippingConfidence: Math.min(1, Math.max(0, toNumber(process.env.MIN_SHIPPING_CONFIDENCE, 0.45))),
    shippingCostBufferPct: Math.max(0, toPct(process.env.SHIPPING_COST_BUFFER_PCT, 15)),
    minimumShippingReserveUsd: Math.max(0, toNumber(process.env.MIN_SHIPPING_RESERVE_USD, 1.5)),
    shippingCostDriftThresholdPct: Math.max(0, toPct(process.env.SHIPPING_COST_DRIFT_THRESHOLD_PCT, 8)),
    shippingCostDriftThresholdUsd: Math.max(0, toNumber(process.env.SHIPPING_COST_DRIFT_THRESHOLD_USD, 1)),
    repriceMinDeltaUsd: Math.max(0, toNumber(process.env.REPRICE_MIN_DELTA_USD, 1)),
    repriceMinDeltaPct: Math.max(0, toPct(process.env.REPRICE_MIN_DELTA_PCT, 3)),
    repriceCooldownHours: Math.max(1, toNumber(process.env.REPRICE_COOLDOWN_HOURS, 24)),
    maxRepricesPerListingPerDay: Math.max(1, toNumber(process.env.MAX_REPRICES_PER_LISTING_PER_DAY, 1)),
  };
}
