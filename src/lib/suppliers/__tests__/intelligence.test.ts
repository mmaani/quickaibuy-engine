import test from "node:test";
import assert from "node:assert/strict";

import {
  compareSupplierIntelligence,
  computeSupplierIntelligenceSignal,
  shouldRejectSupplierEarly,
} from "@/lib/suppliers/intelligence";

test("US market intelligence hard-blocks unresolved origin", () => {
  const signal = computeSupplierIntelligenceSignal({
    supplierKey: "aliexpress",
    destinationCountry: "US",
    availabilitySignal: "IN_STOCK",
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

test("known-origin non-US supplier remains eligible for US market", () => {
  const signal = computeSupplierIntelligenceSignal({
    supplierKey: "alibaba",
    destinationCountry: "US",
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.93,
    shippingEstimates: [
      { label: "Air Express", cost: "6.30", etaMinDays: 6, etaMaxDays: 9, ship_from_country: "CN" },
    ],
    rawPayload: {
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "CN",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "CN",
      snapshotQuality: "HIGH",
    },
    shippingConfidence: 0.91,
    refreshSuccessRate: 0.86,
    historicalSuccessRate: 0.82,
    rateLimitEvents: 1,
    refreshAttempts: 20,
  });

  assert.equal(signal.hasStrongOriginEvidence, true);
  assert.equal(signal.hardBlock, false);
  assert.ok(signal.usMarketPriority > 0);
});

test("weak transparency supplier is blocked", () => {
  const rejected = shouldRejectSupplierEarly({
    supplierKey: "alibaba",
    destinationCountry: "US",
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.9,
    shippingEstimates: [],
    rawPayload: {
      shippingSignal: "MISSING",
      shippingTransparencyState: "MISSING",
      shippingOriginCountry: "CN",
      shippingOriginValidity: "EXPLICIT",
      snapshotQuality: "HIGH",
    },
    shippingConfidence: 0.2,
    estimatedProfitUsd: 18,
    marginPct: 35,
    roiPct: 50,
    minimumMarginPct: 15,
    minimumRoiPct: 20,
  });

  assert.equal(rejected.reject, true);
  assert.equal(rejected.reason, "shipping_transparency_too_weak");
});

test("zero stock is blocked", () => {
  const rejected = shouldRejectSupplierEarly({
    supplierKey: "cjdropshipping",
    destinationCountry: "US",
    availabilitySignal: "OUT_OF_STOCK",
    availabilityConfidence: 0.95,
    rawPayload: {
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "US",
      snapshotQuality: "HIGH",
    },
  });

  assert.equal(rejected.reject, true);
  assert.equal(rejected.reason, "critical_stock_blocked");
});

test("unknown stock is blocked", () => {
  const rejected = shouldRejectSupplierEarly({
    supplierKey: "alibaba",
    destinationCountry: "US",
    availabilitySignal: "UNKNOWN",
    availabilityConfidence: 0.3,
    rawPayload: {
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "CN",
      shippingOriginValidity: "EXPLICIT",
      snapshotQuality: "HIGH",
    },
  });

  assert.equal(rejected.reject, true);
  assert.equal(rejected.reason, "unknown_stock_blocked");
});

test("LOW_STOCK strong supplier with known origin and valid shipping remains eligible with warning", () => {
  const decision = shouldRejectSupplierEarly({
    supplierKey: "cjdropshipping",
    destinationCountry: "US",
    availabilitySignal: "LOW_STOCK",
    availabilityConfidence: 0.9,
    shippingEstimates: [{ label: "CJ Packet", cost: "5.00", etaMinDays: 4, etaMaxDays: 7, ship_from_country: "US" }],
    rawPayload: {
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "US",
      snapshotQuality: "HIGH",
    },
    shippingConfidence: 0.92,
    refreshSuccessRate: 0.94,
    historicalSuccessRate: 0.9,
    estimatedProfitUsd: 18,
    marginPct: 32,
    roiPct: 48,
    minimumMarginPct: 15,
    minimumRoiPct: 20,
  });

  assert.equal(decision.reject, false);
  assert.equal(decision.warning, true);
  assert.equal(decision.stockClass, "LOW");
  assert.equal(decision.lowStockControlledRiskEligible, true);
  assert.equal(decision.monitoringPriority, "PRIORITY_RECHECK");
});

test("LOW_STOCK weak supplier or unresolved origin remains blocked", () => {
  const rejected = shouldRejectSupplierEarly({
    supplierKey: "aliexpress",
    destinationCountry: "US",
    availabilitySignal: "LOW_STOCK",
    availabilityConfidence: 0.72,
    shippingEstimates: [{ label: "AliExpress Standard Shipping", cost: "4.12", etaMinDays: 13, etaMaxDays: 18 }],
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
    estimatedProfitUsd: 12,
    marginPct: 24,
    roiPct: 28,
    minimumMarginPct: 15,
    minimumRoiPct: 20,
  });

  assert.equal(rejected.reject, true);
  assert.equal(rejected.reason, "us_origin_unresolved");
});
