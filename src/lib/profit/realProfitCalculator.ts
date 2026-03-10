import {
  getProfitAssumptions,
  type ProfitAssumptions,
  type ProfitCostBreakdown,
} from "./profitAssumptions";

export type RealProfitInput = {
  marketplacePriceUsd: number;
  supplierPriceUsd: number;
  shippingPriceUsd: number;
  marketplaceKey?: string | null;
  assumptions?: ProfitAssumptions;
};

export type RealProfitResult = {
  assumptions: ProfitAssumptions;
  costs: ProfitCostBreakdown;
  estimatedFeesUsd: number;
  estimatedShippingUsd: number;
  estimatedCogsUsd: number;
  estimatedProfitUsd: number;
  marginPct: number;
  roiPct: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function calcPct(value: number, pct: number): number {
  return round2((value * pct) / 100);
}

export function calculateRealProfit(input: RealProfitInput): RealProfitResult {
  const assumptions = input.assumptions ?? getProfitAssumptions({ marketplaceKey: input.marketplaceKey });

  const shippingPriceUsd = round2(input.shippingPriceUsd);
  const marketplacePriceUsd = round2(input.marketplacePriceUsd);
  const supplierPriceUsd = round2(input.supplierPriceUsd);

  const marketplaceFeeUsd = calcPct(marketplacePriceUsd, assumptions.ebayFeeRatePct);
  const payoutReserveUsd = calcPct(marketplacePriceUsd, assumptions.payoutReservePct);
  const paymentReserveUsd = calcPct(marketplacePriceUsd, assumptions.paymentReservePct);
  const fxReserveUsd = calcPct(marketplacePriceUsd, assumptions.fxReservePct);
  const shippingVarianceUsd = calcPct(shippingPriceUsd, assumptions.shippingVariancePct);

  const variableCostsUsd = round2(
    marketplaceFeeUsd + payoutReserveUsd + paymentReserveUsd + fxReserveUsd + shippingVarianceUsd
  );
  const totalFeeUsd = round2(variableCostsUsd + assumptions.fixedCostUsd);

  const estimatedShippingUsd = round2(shippingPriceUsd + shippingVarianceUsd);
  const estimatedCogsUsd = round2(supplierPriceUsd + assumptions.fixedCostUsd);
  const estimatedFeesUsd = round2(totalFeeUsd - shippingVarianceUsd);
  const estimatedProfitUsd = round2(
    marketplacePriceUsd - supplierPriceUsd - shippingPriceUsd - totalFeeUsd
  );

  const marginPct = marketplacePriceUsd > 0 ? round2((estimatedProfitUsd / marketplacePriceUsd) * 100) : 0;
  const roiPct = estimatedCogsUsd > 0 ? round2((estimatedProfitUsd / estimatedCogsUsd) * 100) : 0;

  return {
    assumptions,
    costs: {
      marketplaceFeeUsd,
      payoutReserveUsd,
      paymentReserveUsd,
      fxReserveUsd,
      shippingVarianceUsd,
      variableCostsUsd,
      fixedCostUsd: assumptions.fixedCostUsd,
      totalFeeUsd,
    },
    estimatedFeesUsd,
    estimatedShippingUsd,
    estimatedCogsUsd,
    estimatedProfitUsd,
    marginPct,
    roiPct,
  };
}
