import {
  buildCompactOrderTimeline,
  getCompactBatchReviewSummary,
  buildOperatorHints,
  getOperatorOrderStep,
  getOperatorOrderStepFromRow,
  getOperatorRowNextAction,
  getOperatorOrderStepFromSignals,
  getPurchaseStatusIndicator,
  getTimelineEventTitle,
} from "../src/lib/orders/operatorConsole";
import type { AdminOrderDetail, AdminOrderEvent } from "../src/lib/orders/getAdminOrdersPageData";
import { normalizeCarrierCode } from "../src/lib/orders/syncTrackingToEbay";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function baseDetail(): AdminOrderDetail {
  return {
    order: {
      id: "order-1",
      marketplace: "ebay",
      marketplaceOrderId: "ebay-1",
      buyerName: null,
      buyerCountry: "US",
      totalPrice: "25.00",
      currency: "USD",
      status: "NEW",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    items: [],
    attempts: [],
    latestAttempt: null,
    readiness: {
      ready: false,
      blockingReasons: ["Missing tracking"],
      orderId: "order-1",
      marketplace: "ebay",
      marketplaceOrderId: "ebay-1",
      orderStatus: "NEW",
      supplierOrderId: null,
      supplierKey: null,
      purchaseStatus: null,
      trackingStatus: null,
      missingFields: ["tracking"],
    },
    lastSyncState: null,
    events: [],
  };
}

function run() {
  const stage = getOperatorOrderStepFromSignals({
    orderStatus: "NEW",
    purchaseStatus: null,
    trackingStatus: null,
    trackingReady: false,
    trackingSynced: false,
    trackingNumberPresent: false,
  });
  assert(stage === "New order", "NEW orders should map to 'New order'");

  const rowStage = getOperatorOrderStepFromRow({
    status: "TRACKING_RECEIVED",
    purchaseStatus: "CONFIRMED",
    trackingStatus: "IN_TRANSIT",
    trackingReady: true,
  });
  assert(rowStage === "Ready to sync", "trackingReady rows should map to 'Ready to sync'");
  const rowAction = getOperatorRowNextAction({
    status: "TRACKING_RECEIVED",
    purchaseStatus: "CONFIRMED",
    trackingStatus: "IN_TRANSIT",
    trackingReady: true,
  });
  assert(rowAction === "Sync tracking", "ready rows should map next action to 'Sync tracking'");

  const detailPurchase = baseDetail();
  detailPurchase.order.status = "PURCHASE_PLACED";
  detailPurchase.latestAttempt = {
    id: "attempt-1",
    supplierKey: "AliExpress",
    attemptNo: 1,
    supplierOrderRef: "SUP-1",
    purchaseStatus: "CONFIRMED",
    trackingNumber: null,
    trackingCarrier: null,
    trackingStatus: "NOT_AVAILABLE",
    manualNote: null,
    purchaseRecordedAt: new Date().toISOString(),
    trackingRecordedAt: null,
    trackingSyncLastAttemptAt: null,
    trackingSyncedAt: null,
    trackingSyncError: null,
    updatedAt: new Date().toISOString(),
  };
  const indicator = getPurchaseStatusIndicator(detailPurchase);
  assert(indicator === "PURCHASE_RECORDED", "confirmed purchase should map to PURCHASE_RECORDED");

  const stageFromDetail = getOperatorOrderStep(detailPurchase);
  assert(stageFromDetail === "Tracking needed", "purchase recorded without tracking should map to 'Tracking needed'");

  const hints = buildOperatorHints(detailPurchase);
  assert(hints.length > 0, "operator hints should not be empty");

  const events: AdminOrderEvent[] = [
    {
      id: "e1",
      eventType: "TRACKING_SYNC_SUCCEEDED",
      eventTs: "2026-03-12T00:00:05.000Z",
      details: {},
    },
    {
      id: "e2",
      eventType: "ORDER_SYNCED",
      eventTs: "2026-03-12T00:00:00.000Z",
      details: {},
    },
  ];
  const timeline = buildCompactOrderTimeline(events);
  assert(timeline.length === 2, "timeline should include mapped events");
  assert(timeline[0].eventType === "TRACKING_SYNCED", "timeline should sort newest first");
  assert(getTimelineEventTitle(timeline[0].eventType) === "Synced", "timeline title mapping should be stable");

  const syncedSummary = getCompactBatchReviewSummary({
    status: "TRACKING_SYNCED",
    purchaseStatus: "CONFIRMED",
    trackingStatus: "NOT_AVAILABLE",
    trackingReady: false,
    hasSupplierLinkage: false,
    trackingSyncError: "older failure should not win",
  });
  assert(syncedSummary.bucket === "synced", "TRACKING_SYNCED rows should bucket as synced");
  assert(syncedSummary.blockedReason === null, "TRACKING_SYNCED rows should not show a stale blocker");
  assert(syncedSummary.nextAction === "Done", "TRACKING_SYNCED rows should be complete");

  assert(
    normalizeCarrierCode("YunExpress Sensitive") === "YunExpress",
    "CJ YunExpress carrier labels should normalize to YunExpress"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "stage mapping",
          "purchase indicator mapping",
          "row next-action mapping",
          "operator hints",
          "timeline mapping and titles",
          "synced summary precedence",
          "carrier normalization",
        ],
      },
      null,
      2
    )
  );
}

run();
