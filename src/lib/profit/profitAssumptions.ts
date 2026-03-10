import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";

export type ProfitAssumptions = {
  country: "JO";
  marketplaceKey: "ebay";
  ebayFeeRatePct: number;
  payoutReservePct: number;
  paymentReservePct: number;
  fxReservePct: number;
  shippingVariancePct: number;
  fixedCostUsd: number;
};

export type ProfitCostBreakdown = {
  marketplaceFeeUsd: number;
  payoutReserveUsd: number;
  paymentReserveUsd: number;
  fxReserveUsd: number;
  shippingVarianceUsd: number;
  variableCostsUsd: number;
  fixedCostUsd: number;
  totalFeeUsd: number;
};

function toNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getProfitAssumptions(input?: {
  marketplaceKey?: string | null;
}): ProfitAssumptions {
  const marketplaceKey = normalizeMarketplaceKey(input?.marketplaceKey ?? "ebay");

  if (marketplaceKey !== "ebay") {
    throw new Error(`Unsupported marketplace economics in v1: ${marketplaceKey}`);
  }

  return {
    country: "JO",
    marketplaceKey: "ebay",
    ebayFeeRatePct: toNumber(process.env.PROFIT_EBAY_FEE_RATE_PCT, 12),
    payoutReservePct: toNumber(process.env.PROFIT_PAYOUT_RESERVE_PCT, 2),
    paymentReservePct: toNumber(process.env.PROFIT_PAYMENT_RESERVE_PCT, 3),
    fxReservePct: toNumber(process.env.PROFIT_FX_RESERVE_PCT, 2),
    shippingVariancePct: toNumber(process.env.PROFIT_SHIPPING_VARIANCE_PCT, 10),
    fixedCostUsd: toNumber(process.env.PROFIT_FIXED_COST_USD, 2),
  };
}
