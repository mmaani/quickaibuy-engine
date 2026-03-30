export type CandidateSelectionFields = {
  normalizedSupplierKey: string;
  supplierProductId: string;
  destinationCountry: string;
  shippingOriginCountry: string | null;
  shippingOriginValidity: string;
  shippingOriginConfidence: number | null;
  supplierWarehouseCountry: string | null;
  shippingTransparencyState: "PRESENT" | "MISSING";
  deliveryEstimateMaxDays: number | null;
  shipping: number;
  shippingReserve: number;
  landedSupplierCost: number;
  supplierSnapshotAgeHours: number | null;
  marketplaceSnapshotAgeHours: number | null;
  supplierCost: number;
  availabilitySignal: string;
  availabilityConfidence: number | null;
  sourceQualityRank: number;
  matchConfidence: number;
  supplierReliabilityScore: number;
  estimatedProfit: number;
  marginPct: number;
  roiPct: number;
  staleMarketplaceSnapshot: boolean;
  shippingUnsafe: boolean;
  availabilityUnsafe: boolean;
  availabilityManualReview: boolean;
  decisionStatus: string;
  listingEligible: boolean;
  pipeline: {
    score: number;
  };
  reliabilityAdjustedProfit: {
    adjustedProfitUsd: number | null;
  };
};

function compareNullableNumbersDesc(a: number | null, b: number | null): number {
  const left = a ?? Number.NEGATIVE_INFINITY;
  const right = b ?? Number.NEGATIVE_INFINITY;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function compareNullableNumbersAsc(a: number | null, b: number | null): number {
  const left = a ?? Number.POSITIVE_INFINITY;
  const right = b ?? Number.POSITIVE_INFINITY;
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

function isKnownOrigin(option: CandidateSelectionFields): boolean {
  return option.shippingOriginValidity === "EXPLICIT" || option.shippingOriginValidity === "STRONG_INFERRED";
}

function isUsOrigin(option: CandidateSelectionFields): boolean {
  return option.destinationCountry === "US" && (option.supplierWarehouseCountry === "US" || option.shippingOriginCountry === "US");
}

function isFastKnownOriginInternational(option: CandidateSelectionFields): boolean {
  return (
    option.destinationCountry === "US" &&
    isKnownOrigin(option) &&
    !isUsOrigin(option) &&
    (option.deliveryEstimateMaxDays ?? Number.POSITIVE_INFINITY) <= 12
  );
}

function areEconomicsCompetitive(left: CandidateSelectionFields, right: CandidateSelectionFields): boolean {
  const adjustedProfitGap = Math.abs(
    (left.reliabilityAdjustedProfit.adjustedProfitUsd ?? Number.NEGATIVE_INFINITY) -
      (right.reliabilityAdjustedProfit.adjustedProfitUsd ?? Number.NEGATIVE_INFINITY)
  );
  const reliabilityGap = Math.abs(left.supplierReliabilityScore - right.supplierReliabilityScore);
  const deliveryGap = Math.abs(
    (left.deliveryEstimateMaxDays ?? Number.POSITIVE_INFINITY) - (right.deliveryEstimateMaxDays ?? Number.POSITIVE_INFINITY)
  );
  return adjustedProfitGap <= 3 && reliabilityGap <= 0.08 && deliveryGap <= 4;
}

function compareUsMarketOriginPreference(left: CandidateSelectionFields, right: CandidateSelectionFields): number {
  const leftUsOrigin = Number(isUsOrigin(left));
  const rightUsOrigin = Number(isUsOrigin(right));
  if (leftUsOrigin !== rightUsOrigin) return leftUsOrigin - rightUsOrigin;

  const leftFastIntl = Number(isFastKnownOriginInternational(left));
  const rightFastIntl = Number(isFastKnownOriginInternational(right));
  if (leftFastIntl !== rightFastIntl) return leftFastIntl - rightFastIntl;

  const leftKnownOrigin = Number(isKnownOrigin(left));
  const rightKnownOrigin = Number(isKnownOrigin(right));
  if (leftKnownOrigin !== rightKnownOrigin) return leftKnownOrigin - rightKnownOrigin;

  return 0;
}

export function chooseBestSupplierOption<T extends CandidateSelectionFields>(options: T[]): T {
  const sorted = [...options].sort((left, right) => {
    const useOriginPreference = areEconomicsCompetitive(left, right);
    const orderedComparisons = [
      Number(left.listingEligible) - Number(right.listingEligible),
      Number(left.decisionStatus === "APPROVED") - Number(right.decisionStatus === "APPROVED"),
      Number(!left.staleMarketplaceSnapshot) - Number(!right.staleMarketplaceSnapshot),
      Number(!left.shippingUnsafe) - Number(!right.shippingUnsafe),
      Number(!left.availabilityManualReview && !left.availabilityUnsafe) -
        Number(!right.availabilityManualReview && !right.availabilityUnsafe),
      Number(left.availabilitySignal === "IN_STOCK") - Number(right.availabilitySignal === "IN_STOCK"),
      Number(left.shippingTransparencyState === "PRESENT") - Number(right.shippingTransparencyState === "PRESENT"),
      Number(isKnownOrigin(left)) - Number(isKnownOrigin(right)),
      compareNullableNumbersDesc(left.availabilityConfidence, right.availabilityConfidence),
      compareNullableNumbersDesc(left.supplierReliabilityScore, right.supplierReliabilityScore),
      compareNullableNumbersDesc(
        left.reliabilityAdjustedProfit.adjustedProfitUsd,
        right.reliabilityAdjustedProfit.adjustedProfitUsd
      ),
      compareNullableNumbersDesc(left.estimatedProfit, right.estimatedProfit),
      compareNullableNumbersDesc(left.roiPct, right.roiPct),
      compareNullableNumbersDesc(left.marginPct, right.marginPct),
      compareNullableNumbersAsc(left.deliveryEstimateMaxDays, right.deliveryEstimateMaxDays),
      compareNullableNumbersAsc(left.shipping + left.shippingReserve, right.shipping + right.shippingReserve),
      compareNullableNumbersAsc(left.landedSupplierCost, right.landedSupplierCost),
      useOriginPreference ? compareUsMarketOriginPreference(left, right) : 0,
      compareNullableNumbersDesc(left.shippingOriginConfidence, right.shippingOriginConfidence),
      left.sourceQualityRank - right.sourceQualityRank,
      compareNullableNumbersDesc(left.pipeline.score, right.pipeline.score),
      compareNullableNumbersDesc(left.matchConfidence, right.matchConfidence),
      compareNullableNumbersAsc(left.supplierSnapshotAgeHours, right.supplierSnapshotAgeHours),
      compareNullableNumbersAsc(left.marketplaceSnapshotAgeHours, right.marketplaceSnapshotAgeHours),
      compareNullableNumbersAsc(left.supplierCost, right.supplierCost),
    ];

    for (const comparison of orderedComparisons) {
      if (comparison !== 0) return comparison > 0 ? -1 : 1;
    }

    return left.normalizedSupplierKey.localeCompare(right.normalizedSupplierKey);
  });

  return sorted[0];
}
