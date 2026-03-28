import test from "node:test";
import assert from "node:assert/strict";

import { computeConfidence } from "@/lib/matching/productMatcher";

test("brand mismatch applies heavy confidence penalty", () => {
  const aligned = computeConfidence({
    supplierTitle: "Apple Watch Band Silicone",
    marketplaceTitle: "Apple Watch Band Silicone Strap",
    supplierPrice: 10,
    marketplacePrice: 20,
  });

  const mismatched = computeConfidence({
    supplierTitle: "Apple Watch Band Silicone",
    marketplaceTitle: "Samsung Watch Band Silicone Strap",
    supplierPrice: 10,
    marketplacePrice: 20,
  });

  assert.ok(mismatched.confidence < aligned.confidence);
  assert.ok(mismatched.penalties.brandMismatchPenalty > 0);
});

test("weak token overlap and large price mismatch reduce confidence", () => {
  const stronger = computeConfidence({
    supplierTitle: "Mini Desk Lamp USB Rechargeable",
    marketplaceTitle: "Mini Desk Lamp USB Rechargeable Bright Light",
    supplierPrice: 20,
    marketplacePrice: 40,
  });

  const weakAndPriceMismatch = computeConfidence({
    supplierTitle: "Mini Desk Lamp USB Rechargeable",
    marketplaceTitle: "Kitchen Storage Basket Organizer",
    supplierPrice: 20,
    marketplacePrice: 180,
  });

  assert.ok(weakAndPriceMismatch.penalties.weakOverlapPenalty > 0);
  assert.ok(weakAndPriceMismatch.penalties.largePriceMismatchPenalty > 0);
  assert.ok(weakAndPriceMismatch.confidence < stronger.confidence);
});
