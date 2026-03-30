import assert from "node:assert/strict";
import test from "node:test";

import { computeRecoveryState } from "@/lib/listings/recoveryState";

test("treats missing ship-from country as supplier recovery block", () => {
  const result = computeRecoveryState({
    decisionStatus: "MANUAL_REVIEW",
    listingEligible: false,
    listingStatus: "PREVIEW",
    listingBlockReason: "shipping intelligence unresolved: MISSING_SHIP_FROM_COUNTRY",
  });

  assert.equal(result.recoveryState, "BLOCKED_SUPPLIER_DRIFT");
  assert.equal(result.recoveryBlockReasonCode, "MISSING_SHIP_FROM_COUNTRY");
  assert.equal(result.reEvaluationNeeded, true);
});

