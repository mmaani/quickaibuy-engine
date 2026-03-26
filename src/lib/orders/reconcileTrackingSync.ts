import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, supplierOrders } from "@/lib/db/schema";
import { createOrderEvent } from "./orderEvents";
import { normalizeCarrierCode } from "./syncTrackingToEbay";
import { ORDER_STATUS } from "./statuses";

export async function reconcileTrackingSync(input: {
  orderId: string;
  supplierOrderId: string;
  trackingCarrier?: string | null;
  actorId?: string;
  source?: string | null;
}) {
  const actorId = input.actorId ?? "orders.reconcile-tracking-sync";
  const source = input.source ?? "MANUAL_EBAY_CONFIRMATION";

  const attemptRows = await db
    .select()
    .from(supplierOrders)
    .where(
      and(
        eq(supplierOrders.id, input.supplierOrderId),
        eq(supplierOrders.orderId, input.orderId)
      )
    )
    .limit(1);
  const attempt = attemptRows[0] ?? null;
  if (!attempt) {
    throw new Error(`Supplier attempt not found for order ${input.orderId}`);
  }

  if (!attempt.trackingNumber?.trim()) {
    throw new Error("Cannot reconcile tracking sync without a tracking number.");
  }

  const nextCarrier =
    normalizeCarrierCode(String(input.trackingCarrier ?? attempt.trackingCarrier ?? "").trim()) ??
    attempt.trackingCarrier;
  const orderRows = await db
    .select({ marketplaceOrderId: orders.marketplaceOrderId })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  const order = orderRows[0] ?? null;

  await db
    .update(supplierOrders)
    .set({
      trackingCarrier: nextCarrier ?? attempt.trackingCarrier,
      trackingStatus:
        attempt.trackingStatus && attempt.trackingStatus !== "NOT_AVAILABLE"
          ? attempt.trackingStatus
          : "IN_TRANSIT",
      trackingSyncLastAttemptAt: new Date(),
      trackingSyncedAt: new Date(),
      trackingSyncError: null,
      updatedAt: new Date(),
    })
    .where(eq(supplierOrders.id, attempt.id));

  await db
    .update(orders)
    .set({
      status: ORDER_STATUS.TRACKING_SYNCED,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, input.orderId));

  await createOrderEvent({
    orderId: input.orderId,
    eventType: "TRACKING_SYNC_SUCCEEDED",
    details: {
      actorId,
      source,
      supplierOrderId: attempt.id,
      marketplaceOrderId: order?.marketplaceOrderId ?? null,
    },
  });

  await createOrderEvent({
    orderId: input.orderId,
    eventType: "STATUS_CHANGED",
    details: {
      actorId,
      previousStatus: ORDER_STATUS.TRACKING_RECEIVED,
      nextStatus: ORDER_STATUS.TRACKING_SYNCED,
      reason: "Historical tracking sync confirmed from live eBay order page",
      source,
    },
  });

  return {
    ok: true,
    orderId: input.orderId,
    supplierOrderId: attempt.id,
    trackingNumber: attempt.trackingNumber,
    trackingCarrier: nextCarrier ?? attempt.trackingCarrier ?? null,
  };
}
