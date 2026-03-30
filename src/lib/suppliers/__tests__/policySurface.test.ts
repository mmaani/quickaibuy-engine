import test from "node:test";
import assert from "node:assert/strict";

import { readSupplierPolicySurface } from "@/lib/suppliers/policySurface";

test("reads controlled-risk low stock policy surface from estimated fees", () => {
  const surface = readSupplierPolicySurface({
    supplierPolicy: {
      stockClass: "LOW",
      stockConfidence: 0.91,
      lowStockControlledRiskEligible: true,
      monitoringPriority: "PRIORITY_RECHECK",
      warning: true,
      reject: false,
      policyReason: null,
      operatorMessage: "LOW_STOCK is allowed under controlled-risk conditions with recheck priority.",
      usPriorityStatus: "US_ORIGIN_PREFERRED",
      originAvailabilityRate: 1,
      shippingTransparencyRate: 0.92,
      deliveryEstimateMinDays: 4,
      deliveryEstimateMaxDays: 7,
      deliveryAcceptableForDestination: true,
    },
    selectedSupplierOption: {
      shippingOriginCountry: "US",
      shippingOriginConfidence: 0.96,
      shippingOriginValidity: "EXPLICIT",
    },
  });

  assert.equal(surface.stockClass, "LOW");
  assert.equal(surface.lowStockControlledRiskEligible, true);
  assert.equal(surface.monitoringPriority, "PRIORITY_RECHECK");
  assert.equal(surface.usPriorityStatus, "US_ORIGIN_PREFERRED");
  assert.equal(surface.shippingOriginCountry, "US");
  assert.equal(surface.shippingOriginValidity, "EXPLICIT");
});

test("reads blocked low stock policy surface deterministically", () => {
  const surface = readSupplierPolicySurface({
    supplierPolicy: {
      stockClass: "LOW",
      stockConfidence: 0.72,
      lowStockControlledRiskEligible: false,
      monitoringPriority: "URGENT_RECHECK",
      warning: false,
      reject: true,
      policyReason: "us_origin_unresolved",
      operatorMessage: "LOW_STOCK failed controlled-risk conditions and is blocked.",
      usPriorityStatus: "ORIGIN_UNRESOLVED_BLOCKED",
    },
  });

  assert.equal(surface.stockClass, "LOW");
  assert.equal(surface.lowStockControlledRiskEligible, false);
  assert.equal(surface.reject, true);
  assert.equal(surface.policyReason, "us_origin_unresolved");
  assert.equal(surface.usPriorityStatus, "ORIGIN_UNRESOLVED_BLOCKED");
});
