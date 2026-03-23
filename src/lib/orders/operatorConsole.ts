import {
  isNewEntryOrderStatus,
  isOrderStatus,
  isSupplierPurchaseRecordedStatus,
  isTrackingStatusNotAvailable,
  isTrackingSyncReadyOrderStatus,
  isTrackingSyncedOrderStatus,
  isWaitingTrackingOrderStatus,
  ORDER_STATUS,
} from "./statuses";
import type { AdminOrderDetail, AdminOrderEvent } from "./getAdminOrdersPageData";

export type PurchaseStatusIndicator =
  | "NOT_PURCHASED"
  | "PURCHASE_RECORDED"
  | "TRACKING_READY"
  | "TRACKING_SYNCED";

export type OperatorOrderStepLabel =
  | "New order"
  | "Review for purchase"
  | "Purchase recorded"
  | "Tracking needed"
  | "Ready to sync"
  | "Synced";

export type OperatorOrderStepFlowRow = {
  label: OperatorOrderStepLabel;
  state: "completed" | "current" | "upcoming";
};

export type OperatorRowNextAction =
  | "Review for purchase"
  | "Approve purchase"
  | "Record supplier purchase"
  | "Add tracking"
  | "Sync tracking"
  | "Done";

export type OperatorRowQuickAction =
  | "mark-purchase"
  | "supplier-ref"
  | "tracking"
  | "preview-sync"
  | "sync-ebay"
  | "view-safety";

export type CompactBatchReviewMode = "detailed" | "compact";
export type CompactBatchReviewBucket =
  | "needs-review"
  | "waiting-purchase"
  | "waiting-tracking"
  | "ready-sync"
  | "blocked-review"
  | "missing-linkage"
  | "synced"
  | "all";

export type CompactBatchReviewSignals = {
  status: string;
  purchaseStatus: string | null;
  trackingStatus: string | null;
  trackingReady: boolean;
  hasSupplierLinkage: boolean;
  trackingSyncError: string | null;
};

export type CompactBatchReviewSummary = {
  bucket: CompactBatchReviewBucket;
  operatorStage: OperatorOrderStepLabel;
  purchaseSafetyState: string;
  readinessState: string;
  nextAction: OperatorRowNextAction;
  blockedReason: string | null;
};

type OperatorOrderStageInput = {
  orderStatus: string | null | undefined;
  purchaseStatus: string | null | undefined;
  trackingStatus: string | null | undefined;
  trackingReady: boolean;
  trackingSynced: boolean;
  trackingNumberPresent: boolean;
};

export type OrderTimelineRow = {
  id: string;
  eventType:
    | "ORDER_INGESTED"
    | "SUPPLIER_PURCHASE_RECORDED"
    | "TRACKING_ADDED"
    | "TRACKING_SYNCED"
    | "STATUS_CHANGED";
  timestamp: string | null;
  description: string;
};

export type ProfitSnapshot = {
  listingPrice: number | null;
  supplierCost: number | null;
  estimatedProfit: number | null;
  supplierCostIsEstimate: boolean;
};

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTimelineEvent(event: AdminOrderEvent): OrderTimelineRow | null {
  const details = asObject(event.details);
  const type = String(event.eventType || "").toUpperCase();

  if (type === "ORDER_SYNCED") {
    return {
      id: event.id,
      eventType: "ORDER_INGESTED",
      timestamp: event.eventTs,
      description: "Order ingested from eBay.",
    };
  }

  if (type === "PURCHASE_PLACED_RECORDED" || type === "PURCHASE_SUBMITTED") {
    const supplierKey = typeof details?.supplierKey === "string" ? details.supplierKey : null;
    const supplierOrderRef =
      typeof details?.supplierOrderRef === "string" ? details.supplierOrderRef : null;
    const refText = supplierOrderRef ? ` (${supplierOrderRef})` : "";
    return {
      id: event.id,
      eventType: "SUPPLIER_PURCHASE_RECORDED",
      timestamp: event.eventTs,
      description: supplierKey
        ? `Supplier purchase recorded with ${supplierKey}${refText}.`
        : `Supplier purchase recorded${refText}.`,
    };
  }

  if (type === "TRACKING_RECORDED" || type === "TRACKING_RECEIVED") {
    const trackingNumber =
      typeof details?.trackingNumber === "string" ? details.trackingNumber : null;
    const trackingCarrier =
      typeof details?.trackingCarrier === "string" ? details.trackingCarrier : null;
    const carrierText = trackingCarrier ? ` via ${trackingCarrier}` : "";
    const numberText = trackingNumber ? ` (${trackingNumber})` : "";
    return {
      id: event.id,
      eventType: "TRACKING_ADDED",
      timestamp: event.eventTs,
      description: `Tracking added${carrierText}${numberText}.`,
    };
  }

  if (type === "TRACKING_SYNC_SUCCEEDED") {
    return {
      id: event.id,
      eventType: "TRACKING_SYNCED",
      timestamp: event.eventTs,
      description: "Tracking synced to eBay.",
    };
  }

  if (type === "STATUS_CHANGED") {
    const fromStatus =
      typeof details?.fromStatus === "string"
        ? details.fromStatus
        : typeof details?.previousStatus === "string"
          ? details.previousStatus
          : null;
    const toStatus =
      typeof details?.toStatus === "string"
        ? details.toStatus
        : typeof details?.nextStatus === "string"
          ? details.nextStatus
          : null;
    return {
      id: event.id,
      eventType: "STATUS_CHANGED",
      timestamp: event.eventTs,
      description:
        fromStatus && toStatus
          ? `Status changed from ${fromStatus} to ${toStatus}.`
          : toStatus
            ? `Status changed to ${toStatus}.`
            : "Status changed.",
    };
  }

  return null;
}

export function getTimelineEventTitle(eventType: OrderTimelineRow["eventType"]): string {
  if (eventType === "ORDER_INGESTED") return "New order";
  if (eventType === "SUPPLIER_PURCHASE_RECORDED") return "Purchase recorded";
  if (eventType === "TRACKING_ADDED") return "Tracking added";
  if (eventType === "TRACKING_SYNCED") return "Synced";
  return "Status changed";
}

export function buildCompactOrderTimeline(events: AdminOrderEvent[]): OrderTimelineRow[] {
  return events
    .map(normalizeTimelineEvent)
    .filter((row): row is OrderTimelineRow => row != null)
    .sort((a, b) => {
      const aTs = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTs - aTs;
    });
}

export function getPurchaseStatusIndicator(detail: AdminOrderDetail): PurchaseStatusIndicator {
  const hasTrackingSynced =
    Boolean(detail.latestAttempt?.trackingSyncedAt) ||
    Boolean(detail.lastSyncState?.trackingSyncedAt) ||
    isTrackingSyncedOrderStatus(String(detail.order.status || "").toUpperCase());
  if (hasTrackingSynced) return "TRACKING_SYNCED";

  const hasTrackingNumber = Boolean(detail.latestAttempt?.trackingNumber?.trim());
  if (hasTrackingNumber && detail.readiness.ready) return "TRACKING_READY";

  const purchaseStatus = String(detail.latestAttempt?.purchaseStatus ?? "").toUpperCase();
  const hasPurchaseRecorded =
    Boolean(detail.latestAttempt?.purchaseRecordedAt) ||
    Boolean(detail.latestAttempt?.supplierOrderRef?.trim()) ||
    isSupplierPurchaseRecordedStatus(purchaseStatus);
  if (hasPurchaseRecorded) return "PURCHASE_RECORDED";

  return "NOT_PURCHASED";
}

export function getOperatorOrderStepFromSignals(input: OperatorOrderStageInput): OperatorOrderStepLabel {
  const orderStatus = String(input.orderStatus ?? "").toUpperCase();
  const purchaseStatus = String(input.purchaseStatus ?? "").toUpperCase();

  if (input.trackingSynced || isTrackingSyncedOrderStatus(orderStatus)) return "Synced";
  if (input.trackingReady || isTrackingSyncReadyOrderStatus(orderStatus)) return "Ready to sync";

  const purchaseRecorded =
    isSupplierPurchaseRecordedStatus(purchaseStatus) || orderStatus === ORDER_STATUS.PURCHASE_PLACED;

  if (purchaseRecorded && !input.trackingNumberPresent) return "Tracking needed";
  if (purchaseRecorded) return "Purchase recorded";

  if (isNewEntryOrderStatus(orderStatus)) return "New order";
  return "Review for purchase";
}

export function getOperatorOrderStep(detail: AdminOrderDetail): OperatorOrderStepLabel {
  return getOperatorOrderStepFromSignals({
    orderStatus: detail.order.status,
    purchaseStatus: detail.latestAttempt?.purchaseStatus,
    trackingStatus: detail.latestAttempt?.trackingStatus,
    trackingReady: detail.readiness.ready,
    trackingSynced:
      Boolean(detail.latestAttempt?.trackingSyncedAt) ||
      Boolean(detail.lastSyncState?.trackingSyncedAt),
    trackingNumberPresent: Boolean(detail.latestAttempt?.trackingNumber?.trim()),
  });
}

export function getOperatorOrderStepFromRow(row: {
  status: string;
  purchaseStatus: string | null;
  trackingStatus: string | null;
  trackingReady: boolean;
}): OperatorOrderStepLabel {
  return getOperatorOrderStepFromSignals({
    orderStatus: row.status,
    purchaseStatus: row.purchaseStatus,
    trackingStatus: row.trackingStatus,
    trackingReady: row.trackingReady,
    trackingSynced: isTrackingSyncedOrderStatus(String(row.status || "").toUpperCase()),
    trackingNumberPresent: !isTrackingStatusNotAvailable(String(row.trackingStatus ?? "").toUpperCase()),
  });
}

export function getOperatorRowNextAction(row: {
  status: string;
  purchaseStatus: string | null;
  trackingStatus: string | null;
  trackingReady: boolean;
}): OperatorRowNextAction {
  const status = String(row.status || "").toUpperCase();
  const purchaseStatus = String(row.purchaseStatus || "").toUpperCase();
  const trackingStatus = String(row.trackingStatus || "").toUpperCase();

  if (isTrackingSyncedOrderStatus(status)) return "Done";
  if (row.trackingReady || isTrackingSyncReadyOrderStatus(status)) return "Sync tracking";
  if (
    isSupplierPurchaseRecordedStatus(purchaseStatus) ||
    isWaitingTrackingOrderStatus(status)
  ) {
    if (isTrackingStatusNotAvailable(trackingStatus) || trackingStatus === "") return "Add tracking";
    return "Sync tracking";
  }
  if (isOrderStatus(status) && status === ORDER_STATUS.PURCHASE_APPROVED) return "Record supplier purchase";
  if (isOrderStatus(status) && status === ORDER_STATUS.READY_FOR_PURCHASE_REVIEW) return "Approve purchase";
  return "Review for purchase";
}

export function getCompactBatchReviewSummary(
  row: CompactBatchReviewSignals
): CompactBatchReviewSummary {
  const status = String(row.status || "").toUpperCase();
  const purchaseStatus = String(row.purchaseStatus || "").toUpperCase();
  const blockedReason =
    !row.hasSupplierLinkage
      ? "Supplier linkage missing"
      : status === ORDER_STATUS.MANUAL_REVIEW
        ? "Safety review required"
        : purchaseStatus === "FAILED"
          ? "Supplier purchase failed"
        : status === "FAILED" || status === "CANCELED"
            ? "Order needs attention"
            : row.trackingSyncError
              ? "Sync issue needs review"
              : (
                    isSupplierPurchaseRecordedStatus(purchaseStatus) ||
                    isWaitingTrackingOrderStatus(status)
                  ) &&
                  (isTrackingStatusNotAvailable(String(row.trackingStatus ?? "").toUpperCase()) ||
                    String(row.trackingStatus ?? "").trim() === "")
                ? "Tracking required"
                : status === ORDER_STATUS.PURCHASE_APPROVED || status === ORDER_STATUS.PURCHASE_PENDING
                  ? "Waiting for supplier purchase"
              : null;

  const operatorStage = getOperatorOrderStepFromRow({
    status: row.status,
    purchaseStatus: row.purchaseStatus,
    trackingStatus: row.trackingStatus,
    trackingReady: row.trackingReady,
  });
  const nextAction = getOperatorRowNextAction({
    status: row.status,
    purchaseStatus: row.purchaseStatus,
    trackingStatus: row.trackingStatus,
    trackingReady: row.trackingReady,
  });

  let purchaseSafetyState = "Checked in workflow";
  if (!row.hasSupplierLinkage) purchaseSafetyState = "Missing linkage";
  else if (blockedReason) purchaseSafetyState = "Manual review";
  else if (
    status === ORDER_STATUS.NEW ||
    status === ORDER_STATUS.NEW_ORDER ||
    status === ORDER_STATUS.READY_FOR_PURCHASE_REVIEW ||
    status === ORDER_STATUS.PURCHASE_APPROVED
  ) {
    purchaseSafetyState = "Safety review required";
  } else if (isTrackingSyncedOrderStatus(status)) {
    purchaseSafetyState = "Completed";
  }

  let readinessState = "Not ready";
  if (isTrackingSyncedOrderStatus(status)) readinessState = "Synced";
  else if (row.trackingReady || isTrackingSyncReadyOrderStatus(status)) readinessState = "Ready to sync";
  else if (
    isSupplierPurchaseRecordedStatus(purchaseStatus) ||
    isWaitingTrackingOrderStatus(status)
  ) {
    readinessState = "Tracking needed";
  } else if (status === ORDER_STATUS.PURCHASE_APPROVED) {
    readinessState = "Waiting for purchase";
  } else if (
    status === ORDER_STATUS.NEW ||
    status === ORDER_STATUS.NEW_ORDER ||
    status === ORDER_STATUS.READY_FOR_PURCHASE_REVIEW
  ) {
    readinessState = "Needs review";
  }

  let bucket: CompactBatchReviewBucket = "all";
  if (!row.hasSupplierLinkage) bucket = "missing-linkage";
  else if (blockedReason) bucket = "blocked-review";
  else if (row.trackingReady || isTrackingSyncReadyOrderStatus(status)) bucket = "ready-sync";
  else if (
    isSupplierPurchaseRecordedStatus(purchaseStatus) ||
    isWaitingTrackingOrderStatus(status)
  ) {
    bucket = "waiting-tracking";
  } else if (status === ORDER_STATUS.PURCHASE_APPROVED || status === ORDER_STATUS.PURCHASE_PENDING) {
    bucket = "waiting-purchase";
  } else if (
    status === ORDER_STATUS.NEW ||
    status === ORDER_STATUS.NEW_ORDER ||
    status === ORDER_STATUS.READY_FOR_PURCHASE_REVIEW
  ) {
    bucket = "needs-review";
  } else if (isTrackingSyncedOrderStatus(status)) {
    bucket = "synced";
  }

  return {
    bucket,
    operatorStage,
    purchaseSafetyState,
    readinessState,
    nextAction,
    blockedReason,
  };
}

export function buildOperatorOrderStepFlow(detail: AdminOrderDetail): OperatorOrderStepFlowRow[] {
  const steps: OperatorOrderStepLabel[] = [
    "New order",
    "Review for purchase",
    "Purchase recorded",
    "Tracking needed",
    "Ready to sync",
    "Synced",
  ];
  const current = getOperatorOrderStep(detail);
  const currentIndex = steps.indexOf(current);

  return steps.map((label, index) => {
    if (index < currentIndex) {
      return { label, state: "completed" as const };
    }
    if (index === currentIndex) {
      return { label, state: "current" as const };
    }
    return { label, state: "upcoming" as const };
  });
}

export function buildProfitSnapshot(detail: AdminOrderDetail): ProfitSnapshot {
  const listingFromOrder = toNumber(detail.order.totalPrice);
  const listingFromItems = detail.items.reduce((acc, item) => {
    const itemPrice = toNumber(item.itemPrice);
    if (itemPrice == null) return acc;
    return acc + itemPrice * item.quantity;
  }, 0);
  const listingPrice =
    listingFromOrder ?? (listingFromItems > 0 ? round2(listingFromItems) : null);

  const supplierCostFromEstimatedCogs = detail.items.reduce((acc, item) => {
    const estimatedCogs = toNumber(item.estimatedSupplierCost);
    if (estimatedCogs == null) return acc;
    return acc + estimatedCogs * item.quantity;
  }, 0);

  const estimatedProfitFromCandidates = detail.items.reduce((acc, item) => {
    const estimatedProfit = toNumber(item.estimatedProfit);
    if (estimatedProfit == null) return acc;
    return acc + estimatedProfit * item.quantity;
  }, 0);

  const hasEstimatedCogs = supplierCostFromEstimatedCogs > 0;
  const hasEstimatedProfit = estimatedProfitFromCandidates !== 0;

  let supplierCost: number | null = hasEstimatedCogs ? round2(supplierCostFromEstimatedCogs) : null;
  let supplierCostIsEstimate = false;

  if (supplierCost == null && hasEstimatedProfit && listingPrice != null) {
    supplierCost = round2(listingPrice - estimatedProfitFromCandidates);
    supplierCostIsEstimate = true;
  }

  let estimatedProfit: number | null = hasEstimatedProfit ? round2(estimatedProfitFromCandidates) : null;
  if (estimatedProfit == null && listingPrice != null && supplierCost != null) {
    estimatedProfit = round2(listingPrice - supplierCost);
  }

  return {
    listingPrice,
    supplierCost,
    estimatedProfit,
    supplierCostIsEstimate,
  };
}

export function buildOperatorHints(detail: AdminOrderDetail): string[] {
  const indicator = getPurchaseStatusIndicator(detail);
  const hints: string[] = [];

  if (indicator === "NOT_PURCHASED") {
    hints.push("Add supplier order reference.");
  } else if (indicator === "PURCHASE_RECORDED") {
    hints.push("Add tracking before syncing.");
  } else if (indicator === "TRACKING_READY") {
    hints.push("Sync tracking to eBay.");
  } else {
    hints.push("Tracking is synced.");
  }

  if (!detail.latestAttempt?.supplierOrderRef) {
    hints.push("Add supplier order reference.");
  } else if (!detail.latestAttempt?.trackingNumber) {
    hints.push("Add tracking number.");
  }

  return Array.from(new Set(hints)).slice(0, 2);
}

export function getDisabledRowQuickActionHint(input: {
  action: OperatorRowQuickAction;
  enabled: boolean;
  hasSupplier: boolean;
}): string | null {
  if (input.enabled) return null;

  if ((input.action === "mark-purchase" || input.action === "supplier-ref") && !input.hasSupplier) {
    return "Add supplier first";
  }
  if (input.action === "tracking") {
    return "Record purchase first";
  }
  if (input.action === "preview-sync") {
    return "Tracking required";
  }
  if (input.action === "sync-ebay") {
    return "Order not ready";
  }
  if (input.action === "view-safety") {
    return "Safety check required";
  }

  return "Order not ready";
}
