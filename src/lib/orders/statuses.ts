export const ORDER_STATUS = {
  NEW: "NEW",
  SYNCED: "SYNCED",
  PURCHASE_PENDING: "PURCHASE_PENDING",
  PURCHASED: "PURCHASED",
  PARTIALLY_PURCHASED: "PARTIALLY_PURCHASED",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  CANCELED: "CANCELED",
  FAILED: "FAILED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  READY_FOR_PURCHASE_REVIEW: "READY_FOR_PURCHASE_REVIEW",
  PURCHASE_APPROVED: "PURCHASE_APPROVED",
  PURCHASE_PLACED: "PURCHASE_PLACED",
  TRACKING_PENDING: "TRACKING_PENDING",
  TRACKING_RECEIVED: "TRACKING_RECEIVED",
  TRACKING_SYNCED: "TRACKING_SYNCED",
  NEW_ORDER: "NEW_ORDER",
} as const;

export const ORDER_STATUSES = Object.values(ORDER_STATUS) as readonly OrderStatus[];

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
  "TRACKING_RECORDED",
  "TRACKING_SYNC_ATTEMPTED",
  "TRACKING_SYNC_SUCCEEDED",
  "TRACKING_SYNC_FAILED",
  "PURCHASE_PLACED_RECORDED",
  "STATUS_CHANGED",
  "MANUAL_NOTE",
] as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
export type SupplierPurchaseStatus = (typeof SUPPLIER_PURCHASE_STATUSES)[number];
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export const ORDER_NEW_ENTRY_STATUSES = [ORDER_STATUS.NEW, ORDER_STATUS.NEW_ORDER] as const;
export const ORDER_REVIEW_QUEUE_STATUSES = [
  ORDER_STATUS.MANUAL_REVIEW,
  ORDER_STATUS.NEW,
  ORDER_STATUS.NEW_ORDER,
  ORDER_STATUS.READY_FOR_PURCHASE_REVIEW,
] as const;
export const ORDER_WAITING_PURCHASE_STATUSES = [
  ORDER_STATUS.PURCHASE_APPROVED,
  ORDER_STATUS.PURCHASE_PENDING,
] as const;
export const ORDER_WAITING_TRACKING_STATUSES = [
  ORDER_STATUS.PURCHASE_PLACED,
  ORDER_STATUS.TRACKING_PENDING,
] as const;
export const ORDER_TRACKING_SYNC_READY_STATUSES = [ORDER_STATUS.TRACKING_RECEIVED] as const;
export const ORDER_TRACKING_SYNCED_STATUSES = [ORDER_STATUS.TRACKING_SYNCED] as const;
export const ORDER_PURCHASE_RECORDABLE_STATUSES = [
  ORDER_STATUS.MANUAL_REVIEW,
  ORDER_STATUS.READY_FOR_PURCHASE_REVIEW,
  ORDER_STATUS.PURCHASE_APPROVED,
  ORDER_STATUS.PURCHASE_PLACED,
  ORDER_STATUS.TRACKING_PENDING,
  ORDER_STATUS.TRACKING_RECEIVED,
  ORDER_STATUS.TRACKING_SYNCED,
] as const;
export const ORDER_TRACKING_RECORDABLE_STATUSES = [
  ORDER_STATUS.PURCHASE_PLACED,
  ORDER_STATUS.TRACKING_PENDING,
  ORDER_STATUS.TRACKING_RECEIVED,
  ORDER_STATUS.TRACKING_SYNCED,
] as const;
export const ORDER_TRACKING_SYNC_PREPARATION_STATUSES = [
  ORDER_STATUS.PURCHASE_PLACED,
  ORDER_STATUS.TRACKING_PENDING,
  ORDER_STATUS.TRACKING_RECEIVED,
] as const;
export const ORDER_SYNC_RESETTABLE_STATUSES = [
  ORDER_STATUS.NEW,
  ORDER_STATUS.SYNCED,
  ORDER_STATUS.MANUAL_REVIEW,
] as const;
export const SUPPLIER_PURCHASE_RECORDED_STATUSES = ["SUBMITTED", "CONFIRMED"] as const;
export const TRACKING_STATUS_NOT_AVAILABLE = "NOT_AVAILABLE";

export function normalizeOrderMarketplace(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isSupplierPurchaseStatus(value: string): value is SupplierPurchaseStatus {
  return (SUPPLIER_PURCHASE_STATUSES as readonly string[]).includes(value);
}

export function isTrackingStatus(value: string): value is TrackingStatus {
  return (TRACKING_STATUSES as readonly string[]).includes(value);
}

function isOneOf<T extends string>(value: string, statuses: readonly T[]): value is T {
  return (statuses as readonly string[]).includes(value);
}

export function isNewEntryOrderStatus(value: string): value is (typeof ORDER_NEW_ENTRY_STATUSES)[number] {
  return isOneOf(value, ORDER_NEW_ENTRY_STATUSES);
}

export function isReviewQueueOrderStatus(value: string): value is (typeof ORDER_REVIEW_QUEUE_STATUSES)[number] {
  return isOneOf(value, ORDER_REVIEW_QUEUE_STATUSES);
}

export function isWaitingPurchaseOrderStatus(
  value: string
): value is (typeof ORDER_WAITING_PURCHASE_STATUSES)[number] {
  return isOneOf(value, ORDER_WAITING_PURCHASE_STATUSES);
}

export function isWaitingTrackingOrderStatus(
  value: string
): value is (typeof ORDER_WAITING_TRACKING_STATUSES)[number] {
  return isOneOf(value, ORDER_WAITING_TRACKING_STATUSES);
}

export function isTrackingSyncReadyOrderStatus(
  value: string
): value is (typeof ORDER_TRACKING_SYNC_READY_STATUSES)[number] {
  return isOneOf(value, ORDER_TRACKING_SYNC_READY_STATUSES);
}

export function isTrackingSyncedOrderStatus(
  value: string
): value is (typeof ORDER_TRACKING_SYNCED_STATUSES)[number] {
  return isOneOf(value, ORDER_TRACKING_SYNCED_STATUSES);
}

export function canRecordSupplierPurchaseForOrderStatus(
  value: string
): value is (typeof ORDER_PURCHASE_RECORDABLE_STATUSES)[number] {
  return isOneOf(value, ORDER_PURCHASE_RECORDABLE_STATUSES);
}

export function canRecordTrackingForOrderStatus(
  value: string
): value is (typeof ORDER_TRACKING_RECORDABLE_STATUSES)[number] {
  return isOneOf(value, ORDER_TRACKING_RECORDABLE_STATUSES);
}

export function canPrepareTrackingSyncForOrderStatus(
  value: string
): value is (typeof ORDER_TRACKING_SYNC_PREPARATION_STATUSES)[number] {
  return isOneOf(value, ORDER_TRACKING_SYNC_PREPARATION_STATUSES);
}

export function isOrderSyncResettableStatus(
  value: string
): value is (typeof ORDER_SYNC_RESETTABLE_STATUSES)[number] {
  return isOneOf(value, ORDER_SYNC_RESETTABLE_STATUSES);
}

export function isSupplierPurchaseRecordedStatus(
  value: string
): value is (typeof SUPPLIER_PURCHASE_RECORDED_STATUSES)[number] {
  return isOneOf(value, SUPPLIER_PURCHASE_RECORDED_STATUSES);
}

export function isTrackingStatusNotAvailable(value: string): value is typeof TRACKING_STATUS_NOT_AVAILABLE {
  return value === TRACKING_STATUS_NOT_AVAILABLE;
}
