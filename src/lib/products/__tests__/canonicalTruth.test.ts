import test from "node:test";
import assert from "node:assert/strict";

import { deriveCanonicalMediaTruth, deriveCanonicalShippingTruth } from "@/lib/products/canonicalTruth";

test("media truth falls back from image count instead of zero for populated media", () => {
  const media = deriveCanonicalMediaTruth({
    rawPayload: {
      images: [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.jpg",
        "https://cdn.example.com/3.jpg",
        "https://cdn.example.com/4.jpg",
        "https://cdn.example.com/5.jpg",
      ],
      mediaQualityScore: 0,
    },
  });

  assert.equal(media.present, true);
  assert.equal(media.imageCount, 5);
  assert.ok(media.mediaQualityScore > 0);
  assert.equal(media.strength, "STRONG");
});

test("canonical shipping pass overrides weaker heuristic indicators", () => {
  const shipping = deriveCanonicalShippingTruth({
    shippingValidity: "PASS",
    transparencyState: "PRESENT",
    originCountry: "CN",
    originConfidence: 0.99,
    sourceConfidence: 0.85,
    resolutionMode: "INFERRED_STRONG",
    deliveryEstimateMinDays: 2,
    deliveryEstimateMaxDays: 6,
    shippingCostUsd: 4,
  });

  assert.equal(shipping.passed, true);
  assert.equal(shipping.weak, false);
  assert.equal(shipping.transparencyIncomplete, false);
  assert.equal(shipping.originUnresolved, false);
});
