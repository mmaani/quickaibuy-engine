import test from "node:test";
import assert from "node:assert/strict";

import {
  computeSupplierSelectionScore,
  selectBestSupplierRowsBeforeListing,
} from "@/lib/listings/supplierSelection";
import {
  canRewritePinnedSupplierLinkageForListingStatus,
  isSupplierLinkageImmutableForListingStatus,
} from "@/lib/listings/linkagePolicy";

type Row = Parameters<typeof computeSupplierSelectionScore>[0];

function buildRow(overrides: Partial<Row>): Row {
  return {
    candidateId: "c1",
    marketplaceKey: "ebay",
    marketplaceListingId: "listing-1",
    supplierKey: "cjdropshipping",
    supplierProductId: "supplier-1",
    estimatedProfit: 15,
    marginPct: 40,
    shippingEstimates: [],
    supplierRawPayload: {
      mediaQualityScore: 0.9,
      availabilityConfidence: 0.9,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.9,
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "US",
      snapshotQuality: "HIGH",
      deliveryEstimateMinDays: 5,
      deliveryEstimateMaxDays: 8,
    },
    supplierPrice: 8,
    ...overrides,
  };
}

test("multi-supplier selection chooses best pre-listing row", () => {
  const weaker = buildRow({
    candidateId: "c-low",
    supplierPrice: 25,
    marginPct: 18,
    supplierRawPayload: {
      mediaQualityScore: 0.35,
      availabilityConfidence: 0.3,
      deliveryEstimateMinDays: 18,
      deliveryEstimateMaxDays: 28,
    },
  });

  const stronger = buildRow({
    candidateId: "c-high",
    supplierPrice: 8,
    marginPct: 42,
    supplierRawPayload: {
      mediaQualityScore: 0.9,
      availabilityConfidence: 0.95,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.92,
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "US",
      snapshotQuality: "HIGH",
      deliveryEstimateMinDays: 4,
      deliveryEstimateMaxDays: 7,
    },
  });

  assert.ok(computeSupplierSelectionScore(stronger) > computeSupplierSelectionScore(weaker));

  const selected = selectBestSupplierRowsBeforeListing([weaker, stronger]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.candidateId, "c-high");
});

test("supplier intelligence deprioritizes weak AliExpress rows before listing", () => {
  const cj = buildRow({
    candidateId: "c-cj",
    supplierKey: "cjdropshipping",
    supplierProductId: "cj-1",
    supplierRawPayload: {
      mediaQualityScore: 0.8,
      availabilityConfidence: 0.82,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.88,
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "US",
      snapshotQuality: "HIGH",
      deliveryEstimateMinDays: 4,
      deliveryEstimateMaxDays: 7,
    },
  });

  const aliWeak = buildRow({
    candidateId: "c-ali",
    supplierKey: "aliexpress",
    supplierProductId: "ali-1",
    supplierRawPayload: {
      mediaQualityScore: 0.9,
      availabilityConfidence: 0.35,
      availabilitySignal: "UNKNOWN",
      availabilityEvidenceQuality: "LOW",
      shippingConfidence: 0.25,
      shippingSignal: "MISSING",
      shippingTransparencyState: "PRESENT",
      snapshotQuality: "LOW",
      deliveryEstimateMinDays: 7,
      deliveryEstimateMaxDays: 10,
    },
  });

  assert.ok(computeSupplierSelectionScore(cj) > computeSupplierSelectionScore(aliWeak));

  const selected = selectBestSupplierRowsBeforeListing([aliWeak, cj]);
  assert.equal(selected[0]?.candidateId, "c-cj");
});

test("US market selection prefers resolved-origin supplier over cheaper unresolved-origin row", () => {
  const cheapAli = buildRow({
    candidateId: "c-ali-cheap",
    supplierKey: "aliexpress",
    supplierPrice: 5,
    marginPct: 55,
    supplierRawPayload: {
      mediaQualityScore: 0.92,
      availabilityConfidence: 0.9,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.82,
      shippingSignal: "PARTIAL",
      shippingTransparencyState: "PRESENT",
      snapshotQuality: "HIGH",
      deliveryEstimateMinDays: 7,
      deliveryEstimateMaxDays: 10,
    },
  });

  const strongerCj = buildRow({
    candidateId: "c-cj-strong",
    supplierKey: "cjdropshipping",
    supplierPrice: 8,
    marginPct: 42,
    supplierRawPayload: {
      mediaQualityScore: 0.88,
      availabilityConfidence: 0.92,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.9,
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "US",
      snapshotQuality: "HIGH",
      deliveryEstimateMinDays: 4,
      deliveryEstimateMaxDays: 6,
    },
  });

  assert.ok(computeSupplierSelectionScore(strongerCj) > computeSupplierSelectionScore(cheapAli));
  const selected = selectBestSupplierRowsBeforeListing([cheapAli, strongerCj]);
  assert.equal(selected[0]?.candidateId, "c-cj-strong");
});

test("no post-approval supplier rebinding for READY/ACTIVE statuses", () => {
  assert.equal(canRewritePinnedSupplierLinkageForListingStatus("PREVIEW"), true);
  assert.equal(isSupplierLinkageImmutableForListingStatus("PREVIEW"), false);

  assert.equal(canRewritePinnedSupplierLinkageForListingStatus("READY_TO_PUBLISH"), false);
  assert.equal(canRewritePinnedSupplierLinkageForListingStatus("ACTIVE"), false);
  assert.equal(isSupplierLinkageImmutableForListingStatus("READY_TO_PUBLISH"), true);
  assert.equal(isSupplierLinkageImmutableForListingStatus("ACTIVE"), true);
});
