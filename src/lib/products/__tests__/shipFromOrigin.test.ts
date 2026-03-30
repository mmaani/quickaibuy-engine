import test from "node:test";
import assert from "node:assert/strict";

import { resolveShipFromOrigin } from "@/lib/products/shipFromOrigin";
import { inferShippingFromEvidence } from "@/lib/pricing/shippingInference";

test("resolveShipFromOrigin extracts deterministic origin from nested variant + destination context", () => {
  const result = resolveShipFromOrigin({
    destinationCountry: "US",
    rawPayload: {
      logistics: {
        routes: [
          { destinationCountry: "US", originCountry: "CN" },
          { destinationCountry: "GB", originCountry: "TR" },
        ],
      },
      variants: [{ skuId: "1", shipFromCountry: "US" }],
    },
  });

  assert.equal(result.originCountry, "US");
  assert.equal(result.originSource, "explicit");
  assert.equal(result.originValidity, "EXPLICIT");
  assert.equal(result.supplierWarehouseCountry, null);
  assert.equal(result.logisticsOriginHint, "US");
  assert.ok(result.originConfidence >= 0.9);
  assert.equal(result.unresolvedReason, null);
});

test("inferShippingFromEvidence does not guess origin from profile when supplier evidence is missing", () => {
  const result = inferShippingFromEvidence({
    supplierKey: "aliexpress",
    destinationCountry: "US",
    rawPayload: {
      shippingMethod: "AliExpress Standard Shipping",
      shippingPriceExplicit: "4.12",
      deliveryEstimateMaxDays: 10,
    },
    profile: {
      supplierKey: "aliexpress",
      destinationCountry: "US",
      sampleCount: 19,
      averageCostUsd: 4.9,
      averageMinDays: 7,
      averageMaxDays: 11,
      dominantOriginCountry: "CN",
      preferredMethods: ["ALIEXPRESS_STANDARD"],
      historicalConfidence: 0.79,
      consistencyScore: 0.92,
    },
  });

  assert.equal(result.originCountry, null);
  assert.equal(result.originSource, "weak");
  assert.ok(result.originConfidence < 0.75);
});

test("resolveShipFromOrigin keeps weak/unresolved state for destination-mismatched evidence", () => {
  const result = resolveShipFromOrigin({
    destinationCountry: "US",
    rawPayload: {
      shipping: {
        routes: [{ destinationCountry: "GB", shipFromCountry: "US" }],
      },
      logistics: {
        destinationCountry: "CA",
        originCountry: "CN",
      },
    },
  });

  assert.equal(result.originCountry, null);
  assert.equal(result.originValidity, "WEAK_OR_UNRESOLVED");
  assert.equal(result.unresolvedReason, "NO_SHIP_FROM_EVIDENCE_FOUND");
});
