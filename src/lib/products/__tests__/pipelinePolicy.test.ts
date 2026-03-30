import test from "node:test";
import assert from "node:assert/strict";

import { evaluateProductPipelinePolicy } from "@/lib/products/pipelinePolicy";

test("LOW_STOCK adds warning flag without treating availability as unconfirmed", () => {
  const result = evaluateProductPipelinePolicy({
    title: "Crystal bedside ambient lamp",
    supplierTitle: "Crystal bedside ambient lamp",
    imageUrl: "https://example.com/1.jpg",
    additionalImageCount: 5,
    mediaQualityScore: 0.9,
    supplierQuality: "HIGH",
    telemetrySignals: [],
    availabilitySignal: "LOW_STOCK",
    availabilityConfidence: 0.92,
    shippingEstimates: [{ cost: "5.00", etaMinDays: 4, etaMaxDays: 7 }],
    shippingConfidence: 0.92,
    actionableSnapshot: true,
    supplierRowDecision: "ACTIONABLE",
    supplierPrice: 12,
    marketplacePrice: 39,
    matchConfidence: 0.92,
    marginPct: 35,
    roiPct: 90,
  });

  assert.ok(result.flags.includes("LOW_STOCK_WARNING"));
  assert.ok(!result.flags.includes("SUPPLIER_LOW_STOCK"));
  assert.ok(!result.flags.includes("AVAILABILITY_NOT_CONFIRMED"));
  assert.equal(result.shippingStable, true);
});
