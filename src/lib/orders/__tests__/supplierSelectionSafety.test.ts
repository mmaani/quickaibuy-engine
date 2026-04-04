import test from "node:test";
import assert from "node:assert/strict";

import { evaluateSupplierSelectionAgainstPinnedLinkage } from "@/lib/orders/supplierSelectionSafety";

test("CJ supplier selection blocks when proof-state is not purchase-safe", () => {
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
          orderCreate: "UNPROVEN",
          orderDetail: "PARTIALLY_PROVEN",
          tracking: "UNPROVEN",
          overall: "PARTIALLY_PROVEN",
          codes: ["CJ_ORDER_CREATE_UNPROVEN"],
          blockingReasons: ["CJ_ORDER_CREATE_NOT_PROVEN"],
          proofSource: "live_validation_2026_04_04",
          runtime: { operationalState: "verified-like", sandbox: false, qpsLimit: 100, quotaLimit: 1000, quotaRemaining: 800 },
        },
      },
    ],
  });

  assert.equal(result, "SUPPLIER_PROOF_REQUIRED");
});
