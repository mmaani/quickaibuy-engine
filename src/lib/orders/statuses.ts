export const ORDER_STATUSES = [
  "NEW",
  "SYNCED",
  "PURCHASE_PENDING",
  "PURCHASED",
  "PARTIALLY_PURCHASED",
  "SHIPPED",
  "DELIVERED",
  "CANCELED",
  "FAILED",
  "MANUAL_REVIEW",
] as const;

export const SUPPLIER_PURCHASE_STATUSES = [
  "PENDING",
  "SUBMITTED",
  "CONFIRMED",
  "FAILED",
  "CANCELED",
] as const;

export const TRACKING_STATUSES = [
  "NOT_AVAILABLE",
  "LABEL_CREATED",
  "IN_TRANSIT",
  "DELIVERED",
  "EXCEPTION",
] as const;

export const ORDER_EVENT_TYPES = [
  "ORDER_SYNCED",
  "PURCHASE_ATTEMPT_CREATED",
  "PURCHASE_SUBMITTED",
  "PURCHASE_FAILED",
  "TRACKING_RECEIVED",
  "STATUS_CHANGED",
  "MANUAL_NOTE",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type SupplierPurchaseStatus = (typeof SUPPLIER_PURCHASE_STATUSES)[number];
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export function normalizeOrderMarketplace(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}
