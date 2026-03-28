import { evaluatePinnedSupplierSafety } from "@/lib/safety/supplierLinkage";
import { hasExactPinnedSupplierIdentityMatch } from "@/lib/orders/pinnedSupplierIdentity";
import { evaluateSupplierSelectionAgainstPinnedLinkage } from "@/lib/orders/supplierSelectionSafety";
import { canRewritePinnedSupplierLinkageForListingStatus } from "@/lib/listings/linkagePolicy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function includesReason(reasons: string[], reason: string): boolean {
  return reasons.includes(reason);
}

function run() {
  const now = new Date("2026-03-28T00:30:00.000Z");

  const missingSupplierProductId = evaluatePinnedSupplierSafety({
    supplierKey: "cjdropshipping",
    supplierProductId: null,
    linkageDeterministic: true,
    supplierLinkLocked: true,
    stockStatus: "IN_STOCK",
    stockVerifiedAt: now,
    requiredQty: 1,
  });
  assert(
    includesReason(missingSupplierProductId, "MISSING_SUPPLIER_PRODUCT_ID"),
    "missing supplier_product_id must block purchase"
  );

  const unlockedLinkage = evaluatePinnedSupplierSafety({
    supplierKey: "cjdropshipping",
    supplierProductId: "SKU-1",
    linkageDeterministic: true,
    supplierLinkLocked: false,
    stockStatus: "IN_STOCK",
    stockVerifiedAt: now,
    requiredQty: 1,
  });
  assert(includesReason(unlockedLinkage, "SUPPLIER_LINK_NOT_LOCKED"), "unlocked linkage must block purchase");

  const stockUnknown = evaluatePinnedSupplierSafety({
    supplierKey: "cjdropshipping",
    supplierProductId: "SKU-1",
    linkageDeterministic: true,
    supplierLinkLocked: true,
    stockStatus: "UNKNOWN",
    stockVerifiedAt: now,
    requiredQty: 1,
  });
  assert(includesReason(stockUnknown, "STOCK_UNKNOWN"), "unknown stock must block purchase");

  const staleStock = evaluatePinnedSupplierSafety({
    supplierKey: "cjdropshipping",
    supplierProductId: "SKU-1",
    linkageDeterministic: true,
    supplierLinkLocked: true,
    stockStatus: "IN_STOCK",
    stockVerifiedAt: new Date("2026-03-27T00:00:00.000Z"),
    requiredQty: 1,
    now,
  });
  assert(includesReason(staleStock, "STOCK_STALE"), "stale stock must block listing readiness");

  assert(
    !hasExactPinnedSupplierIdentityMatch({
      expectedSupplierKey: "cjdropshipping",
      expectedSupplierProductId: "SKU-1",
      fetchedSupplierKey: "cjdropshipping",
      fetchedSupplierProductId: "SKU-2",
    }),
    "exact pinned product mismatch must block purchase"
  );

  const fallbackBlocked = evaluateSupplierSelectionAgainstPinnedLinkage({
    orderItemLinkages: [
      { supplierKey: "cjdropshipping", linkageDeterministic: true, supplierLinkLocked: true },
    ],
    requestedSupplierKey: "aliexpress",
  });
  assert(fallbackBlocked === "SUPPLIER_FALLBACK_BLOCKED", "automatic supplier fallback must be blocked");

  const substitutionBlocked = evaluateSupplierSelectionAgainstPinnedLinkage({
    orderItemLinkages: [
      { supplierKey: "cjdropshipping", linkageDeterministic: true, supplierLinkLocked: true },
      { supplierKey: "aliexpress", linkageDeterministic: true, supplierLinkLocked: true },
    ],
    requestedSupplierKey: "cjdropshipping",
  });
  assert(substitutionBlocked === "SUPPLIER_SUBSTITUTION_BLOCKED", "alternate-product/supplier substitution must be blocked");

  assert(
    canRewritePinnedSupplierLinkageForListingStatus("PREVIEW"),
    "PREVIEW listings should be allowed to refresh pinned linkage"
  );
  assert(
    !canRewritePinnedSupplierLinkageForListingStatus("READY_TO_PUBLISH"),
    "approved/live path listing linkage must not silently change after approval"
  );
  assert(
    !canRewritePinnedSupplierLinkageForListingStatus("ACTIVE"),
    "ACTIVE listing linkage must remain immutable"
  );

  console.log("test_supplier_linkage_closure: ok");
}

run();
