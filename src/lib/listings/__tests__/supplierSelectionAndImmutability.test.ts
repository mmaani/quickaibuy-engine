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
    estimatedProfit: 15,
    marginPct: 40,
    supplierRawPayload: {
      mediaQualityScore: 0.9,
      availabilityConfidence: 0.9,
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
      deliveryEstimateMinDays: 4,
      deliveryEstimateMaxDays: 7,
    },
  });

  assert.ok(computeSupplierSelectionScore(stronger) > computeSupplierSelectionScore(weaker));

  const selected = selectBestSupplierRowsBeforeListing([weaker, stronger]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.candidateId, "c-high");
});

test("no post-approval supplier rebinding for READY/ACTIVE statuses", () => {
  assert.equal(canRewritePinnedSupplierLinkageForListingStatus("PREVIEW"), true);
  assert.equal(isSupplierLinkageImmutableForListingStatus("PREVIEW"), false);

  assert.equal(canRewritePinnedSupplierLinkageForListingStatus("READY_TO_PUBLISH"), false);
  assert.equal(canRewritePinnedSupplierLinkageForListingStatus("ACTIVE"), false);
  assert.equal(isSupplierLinkageImmutableForListingStatus("READY_TO_PUBLISH"), true);
  assert.equal(isSupplierLinkageImmutableForListingStatus("ACTIVE"), true);
});
