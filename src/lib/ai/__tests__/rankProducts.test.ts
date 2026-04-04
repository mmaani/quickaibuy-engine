import test from "node:test";
import assert from "node:assert/strict";

import { rankProducts } from "@/lib/ai/rankProducts";

test("CJ proof-state penalty prevents unproven order-create rows from outranking safer options", () => {
  const ranked = rankProducts(
    [
      {
        candidateId: "cj-risky",
        supplierKey: "cjdropshipping",
        supplierTitle: "Desk lamp",
        estimatedProfit: 22,
        marginPct: 45,
        roiPct: 38,
        matchConfidence: 0.97,
        marketplaceTitle: "Desk lamp with USB charging",
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
            orderDetail: "PARTIALLY_PROVEN",
            tracking: "UNPROVEN",
            overall: "PARTIALLY_PROVEN",
            codes: ["CJ_ORDER_CREATE_UNPROVEN"],
            blockingReasons: ["CJ_ORDER_CREATE_NOT_PROVEN"],
            proofSource: "live_validation_2026_04_04",
            runtime: { operationalState: "verified-like", sandbox: false, qpsLimit: 100, quotaLimit: 1000, quotaRemaining: 800 },
          },
          images: ["a", "b", "c"],
        },
      },
      {
        candidateId: "safe-alt",
        supplierKey: "aliexpress",
        supplierTitle: "Desk lamp",
        estimatedProfit: 18,
        marginPct: 33,
        roiPct: 28,
        matchConfidence: 0.88,
        marketplaceTitle: "Desk lamp with USB charging",
        supplierRawPayload: { images: ["a", "b", "c"] },
      },
    ],
    { feedbackScore: 1200, policyRiskTolerance: "low" }
  );

  assert.equal(ranked[0]?.candidateId, "safe-alt");
});
