import test from "node:test";
import assert from "node:assert/strict";

import { computeSupplierTrustScore } from "@/lib/products/supplierQuality";

test("stable supplier scores high", () => {
  const result = computeSupplierTrustScore({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.94,
    snapshotAgeHours: 3,
    snapshotQuality: "HIGH",
    shippingConfidence: 0.92,
    shippingTransparencyState: "PRESENT",
    shippingOriginValidity: "EXPLICIT",
    priceSeries: [24.1, 24.2, 24.15, 24.18],
    issueRate: 0.02,
    issueCount: 0,
    telemetrySignals: ["parsed"],
  });
  assert.ok(result.supplier_trust_score >= 80);
  assert.equal(result.supplier_trust_band, "SAFE");
});

test("stale inconsistent supplier scores low", () => {
  const result = computeSupplierTrustScore({
    availabilitySignal: "LOW_STOCK",
    availabilityConfidence: 0.5,
    snapshotAgeHours: 72,
    snapshotQuality: "LOW",
    shippingConfidence: 0.35,
    shippingTransparencyState: "MISSING",
    shippingOriginValidity: "UNKNOWN",
    priceSeries: [19, 31, 15, 37],
    issueRate: 0.3,
    issueCount: 12,
    telemetrySignals: ["fallback", "challenge"],
  });
  assert.ok(result.supplier_trust_score < 60);
  assert.equal(result.supplier_trust_band, "BLOCK");
});

test("weak evidence fails closed with reason codes", () => {
  const result = computeSupplierTrustScore({
    availabilitySignal: "UNKNOWN",
    availabilityConfidence: 0.3,
    snapshotQuality: null,
    priceSeries: [21],
  });
  assert.ok(result.supplier_trust_reason_codes.includes("WEAK_EVIDENCE_FAIL_CLOSED"));
  assert.ok(result.supplier_trust_score < 80);
});

test("origin clarity changes trust outcome", () => {
  const strongOrigin = computeSupplierTrustScore({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.9,
    snapshotAgeHours: 5,
    snapshotQuality: "HIGH",
    shippingConfidence: 0.85,
    shippingTransparencyState: "PRESENT",
    shippingOriginValidity: "EXPLICIT",
    priceSeries: [10, 10.2, 10.1],
  });
  const weakOrigin = computeSupplierTrustScore({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.9,
    snapshotAgeHours: 5,
    snapshotQuality: "HIGH",
    shippingConfidence: 0.85,
    shippingTransparencyState: "PRESENT",
    shippingOriginValidity: "UNKNOWN",
    priceSeries: [10, 10.2, 10.1],
  });
  assert.ok(strongOrigin.supplier_trust_score > weakOrigin.supplier_trust_score);
});

test("issue telemetry reduces trust", () => {
  const lowIssues = computeSupplierTrustScore({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.9,
    snapshotAgeHours: 2,
    snapshotQuality: "HIGH",
    shippingConfidence: 0.9,
    shippingTransparencyState: "PRESENT",
    shippingOriginValidity: "EXPLICIT",
    priceSeries: [10, 10.1, 10.05],
    issueRate: 0,
    issueCount: 0,
  });
  const highIssues = computeSupplierTrustScore({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.9,
    snapshotAgeHours: 2,
    snapshotQuality: "HIGH",
    shippingConfidence: 0.9,
    shippingTransparencyState: "PRESENT",
    shippingOriginValidity: "EXPLICIT",
    priceSeries: [10, 10.1, 10.05],
    issueRate: 0.35,
    issueCount: 20,
  });
  assert.ok(highIssues.supplier_issue_penalty > lowIssues.supplier_issue_penalty);
  assert.ok(highIssues.supplier_trust_score < lowIssues.supplier_trust_score);
});
