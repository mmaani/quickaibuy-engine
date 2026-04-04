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
  const { supplierRawPayload: supplierRawPayloadOverride, ...rowOverrides } = overrides;
  const defaultSupplierRawPayload = {
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
    cjProofState: {
      supplierKey: "cjdropshipping",
      evaluatedAt: "2026-04-04T00:00:00.000Z",
      auth: "PROVEN",
      product: "PROVEN",
      variant: "PROVEN",
      stock: "PROVEN",
      freight: "PROVEN",
      orderCreate: "PROVEN",
      orderDetail: "PROVEN",
      tracking: "UNPROVEN",
      overall: "PARTIALLY_PROVEN",
      codes: ["CJ_AUTH_PROVEN", "CJ_PRODUCT_PROVEN", "CJ_VARIANT_PROVEN", "CJ_STOCK_PROVEN", "CJ_FREIGHT_PROVEN", "CJ_ORDER_CREATE_PROVEN", "CJ_ORDER_DETAIL_PROVEN", "CJ_TRACKING_UNPROVEN"],
      blockingReasons: [],
      proofSource: "live_validation_2026_04_04",
      runtime: {
        operationalState: "verified-like",
        sandbox: false,
        qpsLimit: 100,
        quotaLimit: 1000,
        quotaRemaining: 800,
      },
    },
  };
  const supplierRawPayload = {
    ...defaultSupplierRawPayload,
    ...((supplierRawPayloadOverride as Record<string, unknown> | undefined) ?? {}),
  };

  return {
    candidateId: "c1",
    marketplaceKey: "ebay",
    marketplaceListingId: "listing-1",
    supplierKey: "cjdropshipping",
    supplierProductId: "supplier-1",
    estimatedProfit: 15,
    marginPct: 40,
    shippingEstimates: [],
    supplierPrice: 8,
    ...rowOverrides,
    supplierRawPayload,
  };
}

test("CJ rows with unproven order-create proof are fail-closed before listing selection", () => {
  const cjUnproven = buildRow({
    candidateId: "c-cj-unproven",
    supplierKey: "cjdropshipping",
    supplierRawPayload: {
      cjProofState: {
        supplierKey: "cjdropshipping",
        evaluatedAt: "2026-04-04T00:00:00.000Z",
        auth: "PROVEN",
        product: "PROVEN",
        variant: "PROVEN",
        stock: "PROVEN",
        freight: "PROVEN",
        orderCreate: "UNPROVEN",
        orderDetail: "PROVEN",
        tracking: "UNPROVEN",
        overall: "PARTIALLY_PROVEN",
        codes: ["CJ_ORDER_CREATE_UNPROVEN", "CJ_TRACKING_UNPROVEN"],
        blockingReasons: ["CJ_ORDER_CREATE_NOT_PROVEN"],
        proofSource: "live_validation_2026_04_04",
        runtime: {
          operationalState: "verified-like",
          sandbox: false,
          qpsLimit: 100,
          quotaLimit: 1000,
          quotaRemaining: 800,
        },
      },
    },
  });
  const aliSafe = buildRow({
    candidateId: "c-ali-safe",
    supplierKey: "aliexpress",
    supplierRawPayload: {
      mediaQualityScore: 0.8,
      availabilityConfidence: 0.88,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.9,
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

  const selected = selectBestSupplierRowsBeforeListing([cjUnproven, aliSafe]);
  assert.equal(selected[0]?.candidateId, "c-ali-safe");
});

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

  const selected = selectBestSupplierRowsBeforeListing([cheapAli, strongerCj]);
  assert.equal(selected[0]?.candidateId, "c-cj-strong");
});

test("US market selection allows strong known-origin international supplier to beat weak expensive US row", () => {
  const weakUs = buildRow({
    candidateId: "c-us-weak",
    supplierKey: "cjdropshipping",
    supplierPrice: 16,
    marginPct: 24,
    estimatedProfit: 9,
    supplierRawPayload: {
      mediaQualityScore: 0.74,
      availabilityConfidence: 0.8,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.84,
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "US",
      snapshotQuality: "MEDIUM",
      deliveryEstimateMinDays: 8,
      deliveryEstimateMaxDays: 11,
    },
  });

  const strongChina = buildRow({
    candidateId: "c-cn-strong",
    supplierKey: "alibaba",
    supplierPrice: 7,
    marginPct: 46,
    estimatedProfit: 18,
    supplierRawPayload: {
      mediaQualityScore: 0.9,
      availabilityConfidence: 0.94,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.91,
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "CN",
      shippingOriginValidity: "EXPLICIT",
      supplierWarehouseCountry: "CN",
      snapshotQuality: "HIGH",
      deliveryEstimateMinDays: 6,
      deliveryEstimateMaxDays: 9,
    },
  });

  assert.ok(computeSupplierSelectionScore(strongChina) > computeSupplierSelectionScore(weakUs));
  const selected = selectBestSupplierRowsBeforeListing([weakUs, strongChina]);
  assert.equal(selected[0]?.candidateId, "c-cn-strong");
});

test("controlled-risk low stock stays eligible but is penalized against safe stock", () => {
  const safeUs = buildRow({
    candidateId: "c-safe-us",
    supplierPrice: 8,
    marginPct: 42,
    estimatedProfit: 16,
  });
  const lowStockUs = buildRow({
    candidateId: "c-low-stock-us",
    supplierPrice: 7.5,
    marginPct: 40,
    estimatedProfit: 17,
    supplierRawPayload: {
      mediaQualityScore: 0.9,
      availabilityConfidence: 0.92,
      availabilitySignal: "LOW_STOCK",
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

  assert.ok(computeSupplierSelectionScore(safeUs) > computeSupplierSelectionScore(lowStockUs));
  const selected = selectBestSupplierRowsBeforeListing([safeUs, lowStockUs]);
  assert.equal(selected[0]?.candidateId, "c-safe-us");
});

test("supplier trust reduces pre-listing selection priority safely", () => {
  const highTrust = buildRow({
    candidateId: "c-high-trust",
    supplierRawPayload: {
      mediaQualityScore: 0.9,
      availabilityConfidence: 0.9,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.9,
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      snapshotQuality: "HIGH",
      supplierTrustScore: 92,
      supplierTrustBand: "SAFE",
      deliveryEstimateMinDays: 4,
      deliveryEstimateMaxDays: 7,
    },
  });
  const lowTrust = buildRow({
    candidateId: "c-low-trust",
    supplierRawPayload: {
      mediaQualityScore: 0.9,
      availabilityConfidence: 0.9,
      availabilitySignal: "IN_STOCK",
      shippingConfidence: 0.9,
      shippingSignal: "EXACT",
      shippingTransparencyState: "PRESENT",
      shippingOriginCountry: "US",
      shippingOriginValidity: "EXPLICIT",
      snapshotQuality: "HIGH",
      supplierTrustScore: 53,
      supplierTrustBand: "BLOCK",
      deliveryEstimateMinDays: 4,
      deliveryEstimateMaxDays: 7,
    },
  });

  const selected = selectBestSupplierRowsBeforeListing([lowTrust, highTrust]);
  assert.equal(selected[0]?.candidateId, "c-high-trust");
});

test("low stock with unresolved origin remains blocked before listing", () => {
  const blocked = buildRow({
    candidateId: "c-low-blocked",
    supplierKey: "aliexpress",
    supplierPrice: 6,
    marginPct: 35,
    estimatedProfit: 14,
    supplierRawPayload: {
      mediaQualityScore: 0.9,
      availabilityConfidence: 0.85,
      availabilitySignal: "LOW_STOCK",
      shippingConfidence: 0.8,
      shippingSignal: "PARTIAL",
      shippingTransparencyState: "PRESENT",
      snapshotQuality: "HIGH",
      deliveryEstimateMinDays: 8,
      deliveryEstimateMaxDays: 10,
    },
  });

  assert.ok(computeSupplierSelectionScore(blocked) < 0);
});

test("no post-approval supplier rebinding for READY/ACTIVE statuses", () => {
  assert.equal(canRewritePinnedSupplierLinkageForListingStatus("PREVIEW"), true);
  assert.equal(isSupplierLinkageImmutableForListingStatus("PREVIEW"), false);

  assert.equal(canRewritePinnedSupplierLinkageForListingStatus("READY_TO_PUBLISH"), false);
  assert.equal(canRewritePinnedSupplierLinkageForListingStatus("ACTIVE"), false);
  assert.equal(isSupplierLinkageImmutableForListingStatus("READY_TO_PUBLISH"), true);
  assert.equal(isSupplierLinkageImmutableForListingStatus("ACTIVE"), true);
});
