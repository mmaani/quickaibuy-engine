import type { AdminOrderDetail, AdminOrderEvent } from "./getAdminOrdersPageData";

export type PurchaseStatusIndicator =
  | "NOT_PURCHASED"
  | "PURCHASE_RECORDED"
  | "TRACKING_READY"
  | "TRACKING_SYNCED";

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
