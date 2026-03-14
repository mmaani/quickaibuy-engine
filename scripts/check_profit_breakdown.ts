import { calculateRealProfit } from "@/lib/profit/realProfitCalculator";

const sample = calculateRealProfit({
  marketplaceKey: "ebay",
  marketplacePriceUsd: 35,
  supplierPriceUsd: 20,
  shippingPriceUsd: 4,
});

console.log(
  JSON.stringify(
    {
      assumptions: sample.assumptions,
      costs: sample.costs,
      estimatedFeesUsd: sample.estimatedFeesUsd,
      estimatedShippingUsd: sample.estimatedShippingUsd,
      estimatedCogsUsd: sample.estimatedCogsUsd,
      estimatedProfitUsd: sample.estimatedProfitUsd,
      breakEvenPriceUsd: sample.breakEvenPriceUsd,
      marginPct: sample.marginPct,
      roiPct: sample.roiPct,
    },
    null,
    2
  )
);
