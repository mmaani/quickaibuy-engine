import test from "node:test";
import assert from "node:assert/strict";

import { evaluateSupplierSelectionAgainstPinnedLinkage } from "@/lib/orders/supplierSelectionSafety";

test("CJ supplier selection allows purchase-safe proof while tracking stays unproven", () => {
  const result = evaluateSupplierSelectionAgainstPinnedLinkage({
    orderItemLinkages: [{ supplierKey: "cjdropshipping", linkageDeterministic: true, supplierLinkLocked: true }],
    requestedSupplierKey: "cjdropshipping",
    supplierRawPayloads: [
      {
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
          codes: ["CJ_ORDER_CREATE_PROVEN", "CJ_ORDER_DETAIL_PROVEN", "CJ_TRACKING_UNPROVEN"],
          blockingReasons: [],
          proofSource: "live_validation_2026_04_04",
          runtime: { operationalState: "verified-like", sandbox: false, qpsLimit: 100, quotaLimit: 1000, quotaRemaining: 800 },
        },
      },
    ],
  });

  assert.equal(result, null);
});
