import assert from "node:assert/strict";
import { evaluateProfitHardGate } from "@/lib/profit/hardProfitGate";
import { getProfitAssumptions } from "@/lib/profit/profitAssumptions";
import { getPriceGuardThresholds } from "@/lib/profit/priceGuardConfig";

const thresholds = getPriceGuardThresholds();
const assumptions = getProfitAssumptions({ marketplaceKey: "ebay" });

function evaluateCase(input: Partial<Parameters<typeof evaluateProfitHardGate>[0]>) {
  return evaluateProfitHardGate({
    marketplaceKey: "ebay",
    supplierPriceUsd: 20,
    marketplacePriceUsd: 55,
    shippingCostUsd: 6,
    assumptions,
    assumptionsDeterministic: true,
    supplierSnapshotAgeHours: 1,
    marketplaceSnapshotAgeHours: 1,
    thresholds,
    ...input,
  });
}

function includes(result: ReturnType<typeof evaluateProfitHardGate>, code: string) {
  return result.reasonCodes.includes(code as never);
}

const missingShipping = evaluateCase({ shippingCostUsd: null });
assert.equal(missingShipping.allow, false);
assert.equal(includes(missingShipping, "MISSING_SHIPPING_DATA"), true);

const negativeProfit = evaluateCase({ marketplacePriceUsd: 20, supplierPriceUsd: 18, shippingCostUsd: 6 });
assert.equal(negativeProfit.allow, false);
assert.equal(includes(negativeProfit, "PROFIT_BELOW_MINIMUM"), true);

const lowMargin = evaluateCase({ marketplacePriceUsd: 30, supplierPriceUsd: 22, shippingCostUsd: 6 });
assert.equal(lowMargin.allow, false);
assert.equal(includes(lowMargin, "MARGIN_BELOW_MINIMUM"), true);

const lowRoi = evaluateCase({ marketplacePriceUsd: 31, supplierPriceUsd: 25, shippingCostUsd: 5 });
assert.equal(lowRoi.allow, false);
assert.equal(includes(lowRoi, "ROI_BELOW_MINIMUM"), true);

const staleSupplier = evaluateCase({ supplierSnapshotAgeHours: thresholds.maxSupplierSnapshotAgeHours + 1 });
assert.equal(staleSupplier.allow, false);
assert.equal(includes(staleSupplier, "STALE_SUPPLIER_SNAPSHOT"), true);

const staleMarketplace = evaluateCase({
  marketplaceSnapshotAgeHours: thresholds.maxMarketplaceSnapshotAgeHours + 1,
});
assert.equal(staleMarketplace.allow, false);
assert.equal(includes(staleMarketplace, "STALE_MARKETPLACE_SNAPSHOT"), true);

const listingSafety = evaluateCase({});
const purchaseSafety = evaluateCase({});
assert.equal(listingSafety.decision, purchaseSafety.decision);
assert.deepEqual(listingSafety.reasonCodes, purchaseSafety.reasonCodes);

console.log("profit hard gate tests passed");
