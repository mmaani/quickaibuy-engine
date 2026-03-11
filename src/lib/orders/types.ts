import type {
  OrderEventInsert,
  OrderEventRow,
  OrderInsert,
  OrderItemInsert,
  OrderItemRow,
  OrderRow,
  SupplierOrderInsert,
  SupplierOrderRow,
} from "@/lib/db/schema";
import type {
  OrderEventType,
  OrderStatus,
  SupplierPurchaseStatus,
  TrackingStatus,
} from "./statuses";

export type MarketplaceOrder = OrderRow;
export type MarketplaceOrderInsert = OrderInsert;

export type MarketplaceOrderItem = OrderItemRow;
export type MarketplaceOrderItemInsert = OrderItemInsert;

export type MarketplaceOrderEvent = OrderEventRow;
export type MarketplaceOrderEventInsert = OrderEventInsert;

export type SupplierOrderAttempt = SupplierOrderRow;
export type SupplierOrderAttemptInsert = SupplierOrderInsert;

export type OrderDomainStatus = OrderStatus;
export type OrderDomainEventType = OrderEventType;
export type SupplierOrderDomainStatus = SupplierPurchaseStatus;
export type SupplierTrackingDomainStatus = TrackingStatus;
