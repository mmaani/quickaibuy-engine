import { calculateRealProfit, type RealProfitResult } from "./realProfitCalculator";
import type { PriceGuardThresholds } from "./priceGuardConfig";
import type { ProfitAssumptions } from "./profitAssumptions";

export type ProfitHardGateReasonCode =
  | "MISSING_SUPPLIER_PRICE"
  | "MISSING_MARKETPLACE_PRICE"
  | "MISSING_SHIPPING_DATA"
  | "MISSING_FEE_ASSUMPTIONS"
  | "SUPPLIER_SNAPSHOT_AGE_UNAVAILABLE"
  | "MARKETPLACE_SNAPSHOT_AGE_UNAVAILABLE"
  | "STALE_SUPPLIER_SNAPSHOT"
  | "STALE_MARKETPLACE_SNAPSHOT"
  | "INCOMPLETE_ECONOMICS"
  | "PROFIT_BELOW_MINIMUM"
  | "MARGIN_BELOW_MINIMUM"
  | "ROI_BELOW_MINIMUM";

export type ProfitHardGateInput = {
  marketplaceKey: string;
  supplierPriceUsd: number | null;
  marketplacePriceUsd: number | null;
  shippingCostUsd: number | null;
  assumptions: ProfitAssumptions | null;
  assumptionsDeterministic: boolean;
  supplierSnapshotAgeHours: number | null;
  marketplaceSnapshotAgeHours: number | null;
  thresholds: PriceGuardThresholds;
};

export type ProfitHardGateResult = {
  allow: boolean;
  reasonCodes: ProfitHardGateReasonCode[];
  decision: "ALLOW" | "BLOCK";
  economics: RealProfitResult | null;
  blockReason: string | null;
};

function summarizeReasonCodes(reasonCodes: ProfitHardGateReasonCode[]): string | null {
  if (!reasonCodes.length) return null;
  return reasonCodes.join(", ");
}

export function evaluateProfitHardGate(input: ProfitHardGateInput): ProfitHardGateResult {
  const reasonCodes: ProfitHardGateReasonCode[] = [];

  if (input.supplierPriceUsd == null || input.supplierPriceUsd <= 0) {
    reasonCodes.push("MISSING_SUPPLIER_PRICE");
  }
  if (input.marketplacePriceUsd == null || input.marketplacePriceUsd <= 0) {
    reasonCodes.push("MISSING_MARKETPLACE_PRICE");
  }
  if (input.shippingCostUsd == null || input.shippingCostUsd < 0) {
    reasonCodes.push("MISSING_SHIPPING_DATA");
  }
  if (!input.assumptions || !input.assumptionsDeterministic) {
    reasonCodes.push("MISSING_FEE_ASSUMPTIONS");
  }
  if (input.supplierSnapshotAgeHours == null) {
    reasonCodes.push("SUPPLIER_SNAPSHOT_AGE_UNAVAILABLE");
  } else if (input.supplierSnapshotAgeHours > input.thresholds.maxSupplierSnapshotAgeHours) {
    reasonCodes.push("STALE_SUPPLIER_SNAPSHOT");
  }
  if (input.marketplaceSnapshotAgeHours == null) {
    reasonCodes.push("MARKETPLACE_SNAPSHOT_AGE_UNAVAILABLE");
  } else if (input.marketplaceSnapshotAgeHours > input.thresholds.maxMarketplaceSnapshotAgeHours) {
    reasonCodes.push("STALE_MARKETPLACE_SNAPSHOT");
  }

  const canComputeEconomics =
    input.supplierPriceUsd != null &&
    input.supplierPriceUsd > 0 &&
    input.marketplacePriceUsd != null &&
    input.marketplacePriceUsd > 0 &&
    input.shippingCostUsd != null &&
    input.shippingCostUsd >= 0 &&
    input.assumptions != null &&
    input.assumptionsDeterministic;

  const economics = canComputeEconomics
    ? calculateRealProfit({
        marketplaceKey: input.marketplaceKey,
        supplierPriceUsd: input.supplierPriceUsd!,
        marketplacePriceUsd: input.marketplacePriceUsd!,
        shippingPriceUsd: input.shippingCostUsd!,
        assumptions: input.assumptions ?? undefined,
      })
    : null;

  if (!economics) {
    reasonCodes.push("INCOMPLETE_ECONOMICS");
  } else {
    if (economics.estimatedProfitUsd < input.thresholds.minProfitUsd) {
      reasonCodes.push("PROFIT_BELOW_MINIMUM");
    }
    if (economics.marginPct < input.thresholds.minMarginPct) {
      reasonCodes.push("MARGIN_BELOW_MINIMUM");
    }
    if (economics.roiPct < input.thresholds.minRoiPct) {
      reasonCodes.push("ROI_BELOW_MINIMUM");
    }
  }

  const allow = reasonCodes.length === 0;
  return {
    allow,
    decision: allow ? "ALLOW" : "BLOCK",
    reasonCodes,
    economics,
    blockReason: summarizeReasonCodes(reasonCodes),
  };
}
