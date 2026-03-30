export type MarketDepthOpportunityType = "FLOOR_PLAY" | "STANDARD_PLAY" | "PREMIUM_PLAY" | "NOISY";

export type MarketDepthSignal = {
  listingCount: number;
  floorPriceUsd: number;
  medianPriceUsd: number;
  premiumClusterPriceUsd: number | null;
  outlierLowPriceUsd: number | null;
  outlierHighPriceUsd: number | null;
  noiseRatio: number;
  premiumRatio: number;
  opportunityType: MarketDepthOpportunityType;
  opportunityBand: {
    lowUsd: number;
    targetUsd: number;
    highUsd: number;
  };
};

export type ReliabilityAdjustedProfitInput = {
  nominalProfitUsd: number;
  supplierCostUsd: number;
  shippingCostUsd: number;
  platformFeesUsd: number;
  reserveCostUsd: number;
  supplierReliabilityScore: number;
  shippingConfidenceScore: number;
  marketNoiseRatio: number;
};

export type ReliabilityAdjustedProfitResult = {
  adjustedProfitUsd: number;
  reliabilityScore: number;
  penaltyUsd: number;
  penalties: {
    supplierReliabilityPenaltyUsd: number;
    shippingUncertaintyPenaltyUsd: number;
    marketNoisePenaltyUsd: number;
  };
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function quantile(values: number[], percentile: number): number {
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentile;
  const base = Math.floor(position);
  const remainder = position - base;
  const lower = sorted[base] ?? sorted[0];
  const upper = sorted[base + 1] ?? sorted[sorted.length - 1];
  return lower + remainder * (upper - lower);
}

export function buildMarketDepthSignal(prices: number[], candidatePriceUsd: number): MarketDepthSignal {
  const cleanPrices = prices.filter((price) => Number.isFinite(price) && price > 0);
  const median = quantile(cleanPrices, 0.5);
  const q1 = quantile(cleanPrices, 0.25);
  const q3 = quantile(cleanPrices, 0.75);
  const iqr = Math.max(0, q3 - q1);
  const floor = cleanPrices.length ? Math.min(...cleanPrices) : candidatePriceUsd;
  const outlierLow = iqr > 0 ? q1 - 1.5 * iqr : null;
  const outlierHigh = iqr > 0 ? q3 + 1.5 * iqr : null;
  const noisyCount = cleanPrices.filter((price) => {
    if (outlierLow == null || outlierHigh == null) return false;
    return price < outlierLow || price > outlierHigh;
  }).length;
  const premiumThreshold = median > 0 ? median * 1.2 : candidatePriceUsd * 1.2;
  const premiumCluster = cleanPrices.filter((price) => price >= premiumThreshold);
  const premiumPrice = premiumCluster.length ? quantile(premiumCluster, 0.5) : null;
  const noiseRatio = cleanPrices.length ? noisyCount / cleanPrices.length : 1;
  const premiumRatio = cleanPrices.length ? premiumCluster.length / cleanPrices.length : 0;
  const spreadRatio = floor > 0 ? Math.max(...cleanPrices) / floor : 0;

  let opportunityType: MarketDepthOpportunityType = "STANDARD_PLAY";
  if (noiseRatio > 0.35 || cleanPrices.length < 3 || (spreadRatio >= 2.4 && cleanPrices.length >= 5)) {
    opportunityType = "NOISY";
  } else if (candidatePriceUsd <= q1 || candidatePriceUsd <= floor * 1.05) {
    opportunityType = "FLOOR_PLAY";
  } else if (premiumPrice != null && candidatePriceUsd >= median * 1.15) {
    opportunityType = "PREMIUM_PLAY";
  }

  return {
    listingCount: cleanPrices.length,
    floorPriceUsd: round2(floor),
    medianPriceUsd: round2(median || candidatePriceUsd),
    premiumClusterPriceUsd: premiumPrice == null ? null : round2(premiumPrice),
    outlierLowPriceUsd: outlierLow == null ? null : round2(outlierLow),
    outlierHighPriceUsd: outlierHigh == null ? null : round2(outlierHigh),
    noiseRatio: round2(noiseRatio),
    premiumRatio: round2(premiumRatio),
    opportunityType,
    opportunityBand: {
      lowUsd: round2(Math.max(floor, q1 || floor)),
      targetUsd: round2(median || candidatePriceUsd),
      highUsd: round2((premiumPrice ?? q3 ?? median) || candidatePriceUsd),
    },
  };
}

export function computeReliabilityAdjustedProfit(
  input: ReliabilityAdjustedProfitInput
): ReliabilityAdjustedProfitResult {
  const supplierRisk = 1 - Math.max(0, Math.min(1, input.supplierReliabilityScore));
  const shippingRisk = 1 - Math.max(0, Math.min(1, input.shippingConfidenceScore));
  const noiseRisk = Math.max(0, Math.min(1, input.marketNoiseRatio));

  const atRiskBase = Math.max(
    0,
    input.nominalProfitUsd + input.platformFeesUsd * 0.15 + input.reserveCostUsd * 0.25
  );

  const supplierReliabilityPenaltyUsd = atRiskBase * supplierRisk * 0.35;
  const shippingUncertaintyPenaltyUsd = atRiskBase * shippingRisk * 0.3;
  const marketNoisePenaltyUsd = atRiskBase * noiseRisk * 0.25;
  const penaltyUsd = supplierReliabilityPenaltyUsd + shippingUncertaintyPenaltyUsd + marketNoisePenaltyUsd;
  const adjustedProfitUsd = input.nominalProfitUsd - penaltyUsd;
  const reliabilityScore = 1 - Math.max(0, Math.min(1, penaltyUsd / Math.max(1, atRiskBase)));

  return {
    adjustedProfitUsd: round2(adjustedProfitUsd),
    reliabilityScore: round2(reliabilityScore),
    penaltyUsd: round2(penaltyUsd),
    penalties: {
      supplierReliabilityPenaltyUsd: round2(supplierReliabilityPenaltyUsd),
      shippingUncertaintyPenaltyUsd: round2(shippingUncertaintyPenaltyUsd),
      marketNoisePenaltyUsd: round2(marketNoisePenaltyUsd),
    },
  };
}
