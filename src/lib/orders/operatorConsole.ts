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
    const fromStatus = typeof details?.fromStatus === "string" ? details.fromStatus : null;
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
    String(detail.order.status || "").toUpperCase() === "TRACKING_SYNCED";
  if (hasTrackingSynced) return "TRACKING_SYNCED";

  const hasTrackingNumber = Boolean(detail.latestAttempt?.trackingNumber?.trim());
  if (hasTrackingNumber && detail.readiness.ready) return "TRACKING_READY";

  const purchaseStatus = String(detail.latestAttempt?.purchaseStatus ?? "").toUpperCase();
  const hasPurchaseRecorded =
    Boolean(detail.latestAttempt?.purchaseRecordedAt) ||
    Boolean(detail.latestAttempt?.supplierOrderRef?.trim()) ||
    purchaseStatus === "SUBMITTED" ||
    purchaseStatus === "CONFIRMED";
  if (hasPurchaseRecorded) return "PURCHASE_RECORDED";

  return "NOT_PURCHASED";
}

export function getOperatorOrderStepFromSignals(input: OperatorOrderStageInput): OperatorOrderStepLabel {
  const orderStatus = String(input.orderStatus ?? "").toUpperCase();
  const purchaseStatus = String(input.purchaseStatus ?? "").toUpperCase();
  const trackingStatus = String(input.trackingStatus ?? "").toUpperCase();

  if (input.trackingSynced || orderStatus === "TRACKING_SYNCED") return "Synced";
  if (input.trackingReady || trackingStatus === "TRACKING_RECEIVED") return "Ready to sync";

  const purchaseRecorded =
    purchaseStatus === "SUBMITTED" || purchaseStatus === "CONFIRMED" || orderStatus === "PURCHASE_PLACED";

  if (purchaseRecorded && !input.trackingNumberPresent) return "Tracking needed";
  if (purchaseRecorded) return "Purchase recorded";

  if (orderStatus === "NEW" || orderStatus === "NEW_ORDER") return "New order";
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
    trackingSynced: String(row.status || "").toUpperCase() === "TRACKING_SYNCED",
    trackingNumberPresent: String(row.trackingStatus ?? "").toUpperCase() !== "NOT_AVAILABLE",
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

  if (status === "TRACKING_SYNCED") return "Done";
  if (row.trackingReady || status === "TRACKING_RECEIVED") return "Sync tracking";
  if (
    purchaseStatus === "SUBMITTED" ||
    purchaseStatus === "CONFIRMED" ||
    status === "PURCHASE_PLACED" ||
    status === "TRACKING_PENDING"
  ) {
    if (trackingStatus === "NOT_AVAILABLE" || trackingStatus === "") return "Add tracking";
    return "Sync tracking";
  }
  if (status === "PURCHASE_APPROVED") return "Record supplier purchase";
  if (status === "READY_FOR_PURCHASE_REVIEW") return "Approve purchase";
  return "Review for purchase";
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
