import dotenv from "dotenv";
import { getInventoryRiskRecurringJobId, getInventoryRiskScheduleSnapshotFromEntries, INVENTORY_RISK_SCAN_EVERY_MS } from "@/lib/jobs/enqueueInventoryRiskScan";
import { buildFollowUpJobId } from "@/lib/jobs/followUpJobIds";
import { computeRecoveryState } from "@/lib/listings/recoveryState";
import { sanitizeEbayPayload } from "@/lib/marketplaces/ebayPublish";

dotenv.config({ path: ".env.local" });
dotenv.config();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function testFollowUpJobIds() {
  const productScoped = buildFollowUpJobId({
    jobName: "MATCH_PRODUCT",
    sourceJobId: "scan-123",
    productRawId: "raw-456",
    limit: 25,
  });
  assert(productScoped === "MATCH_PRODUCT:raw-456", `unexpected product-scoped id: ${productScoped}`);

  const batchScoped = buildFollowUpJobId({
    jobName: "EVAL_PROFIT",
    sourceJobId: "match-789",
    limit: 50,
  });
  assert(
    batchScoped === "EVAL_PROFIT:from:match-789:limit:50",
    `unexpected batch-scoped id: ${batchScoped}`
  );
}

function testInventoryRiskScheduleSnapshot() {
  const recurringJobId = getInventoryRiskRecurringJobId("ebay");
  const snapshot = getInventoryRiskScheduleSnapshotFromEntries({
    marketplaceKey: "ebay",
    repeatableJobs: [
      {
        name: "INVENTORY_RISK_SCAN",
        id: recurringJobId,
        key: `bull:${recurringJobId}`,
        every: INVENTORY_RISK_SCAN_EVERY_MS,
        next: Date.now() + INVENTORY_RISK_SCAN_EVERY_MS,
      },
    ],
  });

  assert(snapshot.scheduleActive, "inventory risk schedule should be active");
  assert(snapshot.recurringJobId === recurringJobId, "inventory risk recurring id mismatch");
  assert(snapshot.matchedEntries === 1, `expected one matching repeatable job, got ${snapshot.matchedEntries}`);
  assert(typeof snapshot.nextRun === "string" && snapshot.nextRun.length > 0, "expected nextRun to be set");
}

function testRecoveryStateClassification() {
  const staleSupplier = computeRecoveryState({
    decisionStatus: "MANUAL_REVIEW",
    listingEligible: false,
    listingStatus: "PUBLISH_FAILED",
    listingBlockReason: "PRICE_GUARD_BLOCK: STALE_SUPPLIER_SNAPSHOT, SUPPLIER_SNAPSHOT_AGE_REQUIRED",
  });
  assert(
    staleSupplier.recoveryState === "BLOCKED_STALE_SUPPLIER",
    `expected BLOCKED_STALE_SUPPLIER, got ${staleSupplier.recoveryState}`
  );
  assert(staleSupplier.reEvaluationNeeded, "stale supplier block should require re-evaluation");

  const readyForRepromotion = computeRecoveryState({
    decisionStatus: "APPROVED",
    listingEligible: true,
    listingStatus: "PREVIEW",
    listingBlockReason: null,
  });
  assert(
    readyForRepromotion.recoveryState === "READY_FOR_REPROMOTION",
    `expected READY_FOR_REPROMOTION, got ${readyForRepromotion.recoveryState}`
  );
  assert(readyForRepromotion.rePromotionReady, "ready-for-repromotion should allow re-promotion");
}

function testSanitizeEbayPayloadSourceFields() {
  const sanitized = sanitizeEbayPayload({
    title: "Test",
    source: {
      candidateId: "cand-1",
      supplierKey: "cjdropshipping",
      supplierProductId: "prod-1",
      supplierTitle: "Supplier Title",
      supplierSourceUrl: "https://supplier.example/item",
      supplierWarehouseCountry: "CN",
      shipFromCountry: "CN",
      supplierImageUrl: "https://supplier.example/image.jpg",
      supplierImages: ["https://supplier.example/image.jpg"],
    },
  });

  const source = (sanitized.source ?? {}) as Record<string, unknown>;
  assert(source.supplierTitle === "Supplier Title", "supplierTitle should be preserved in sanitized payload");
  assert(
    source.supplierSourceUrl === "https://supplier.example/item",
    "supplierSourceUrl should be preserved in sanitized payload"
  );
}

async function main() {
  testFollowUpJobIds();
  testInventoryRiskScheduleSnapshot();
  testRecoveryStateClassification();
  testSanitizeEbayPayloadSourceFields();
  console.log(JSON.stringify({ ok: true, script: "test_hardening_regressions" }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
