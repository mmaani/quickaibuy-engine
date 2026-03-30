import test from "node:test";
import assert from "node:assert/strict";

import {
  compareSupplierIntelligence,
  computeSupplierIntelligenceSignal,
  shouldRejectSupplierEarly,
} from "@/lib/suppliers/intelligence";

test("US market intelligence hard-blocks unresolved origin and low stock", () => {
  const signal = computeSupplierIntelligenceSignal({
    supplierKey: "aliexpress",
    destinationCountry: "US",
    availabilitySignal: "LOW_STOCK",
    availabilityConfidence: 0.82,
    shippingEstimates: [{ label: "AliExpress Standard Shipping", cost: "4.12" }],
    rawPayload: {
      shippingSignal: "PARTIAL",
      shippingTransparencyState: "PRESENT",
      snapshotQuality: "HIGH",
    },
    shippingConfidence: 0.86,
    refreshSuccessRate: 0.63,
    historicalSuccessRate: 0.55,
    rateLimitEvents: 13,
    refreshAttempts: 35,
  });

  assert.equal(signal.hasStrongOriginEvidence, false);
  assert.equal(signal.lowStockOrWorse, true);
  assert.equal(signal.hardBlock, true);
});

test("CJ with known US warehouse outranks weak AliExpress for US market", () => {
  const cj = computeSupplierIntelligenceSignal({
    supplierKey: "cjdropshipping",
    destinationCountry: "US",
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.95,
    shippingEstimates: [
      { label: "CJ Packet", cost: "5.20", etaMinDays: 4, etaMaxDays: 7, ship_from_country: "US" },
    ],
    rawPayload: {
      shippingSignal: "DIRECT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "US",
      snapshotQuality: "HIGH",
    },
    shippingConfidence: 0.92,
    refreshSuccessRate: 1,
    historicalSuccessRate: 0.96,
    rateLimitEvents: 0,
    refreshAttempts: 12,
  });

  const ali = computeSupplierIntelligenceSignal({
    supplierKey: "aliexpress",
    destinationCountry: "US",
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.72,
    shippingEstimates: [{ label: "AliExpress Standard Shipping", cost: "4.12", etaMinDays: 7, etaMaxDays: 10 }],
    rawPayload: {
      shippingSignal: "PARTIAL",
      shippingTransparencyState: "PRESENT",
      snapshotQuality: "LOW",
    },
    shippingConfidence: 0.7,
    refreshSuccessRate: 0.63,
    historicalSuccessRate: 0.4,
    rateLimitEvents: 13,
    refreshAttempts: 35,
  });

  assert.ok(compareSupplierIntelligence(cj, ali) < 0);
  assert.ok(cj.reliabilityScore > ali.reliabilityScore);
});

test("early reject gate blocks unresolved-origin and weak-reliability suppliers before pipeline", () => {
  const rejected = shouldRejectSupplierEarly({
    supplierKey: "aliexpress",
    destinationCountry: "US",
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.7,
    shippingEstimates: [{ label: "AliExpress Standard Shipping", cost: "4.12" }],
    rawPayload: {
      shippingSignal: "PARTIAL",
      shippingTransparencyState: "PRESENT",
      snapshotQuality: "LOW",
    },
    shippingConfidence: 0.68,
    refreshSuccessRate: 0.5,
    historicalSuccessRate: 0.35,
    rateLimitEvents: 10,
    refreshAttempts: 20,
  });

  assert.equal(rejected.reject, true);
  assert.equal(rejected.reason, "us_origin_unresolved");
});
