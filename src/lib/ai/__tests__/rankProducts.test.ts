import test from "node:test";
import assert from "node:assert/strict";

import { rankProducts } from "@/lib/ai/rankProducts";

test("tracking-unproven CJ rows still rank below identical tracking-proven rows after order proof promotion", () => {
  const ranked = rankProducts(
    [
      {
        candidateId: "cj-tracking-unproven",
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
            orderCreate: "PROVEN",
            orderDetail: "PROVEN",
            tracking: "UNPROVEN",
            overall: "PARTIALLY_PROVEN",
            codes: ["CJ_ORDER_CREATE_PROVEN", "CJ_ORDER_DETAIL_PROVEN", "CJ_TRACKING_UNPROVEN"],
            blockingReasons: [],
            proofSource: "live_validation_2026_04_04",
            runtime: { operationalState: "verified-like", sandbox: false, qpsLimit: 100, quotaLimit: 1000, quotaRemaining: 800 },
          },
          images: ["a", "b", "c"],
        },
      },
      {
        candidateId: "cj-tracking-proven",
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
            orderCreate: "PROVEN",
            orderDetail: "PROVEN",
            tracking: "PROVEN",
            overall: "PROVEN",
            codes: ["CJ_ORDER_CREATE_PROVEN", "CJ_ORDER_DETAIL_PROVEN"],
            blockingReasons: [],
            proofSource: "live_validation_2026_04_04",
            runtime: { operationalState: "verified-like", sandbox: false, qpsLimit: 100, quotaLimit: 1000, quotaRemaining: 800 },
          },
          images: ["a", "b", "c"],
        },
      },
    ],
    { feedbackScore: 1200, policyRiskTolerance: "low" }
  );

  assert.equal(ranked[0]?.candidateId, "cj-tracking-proven");
});
