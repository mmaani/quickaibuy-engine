import { and, desc, eq, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, supplierOrders } from "@/lib/db/schema";
import { createOrderEvent } from "./orderEvents";
import {
  isSupplierPurchaseStatus,
  isTrackingStatus,
  type SupplierPurchaseStatus,
  type TrackingStatus,
} from "./statuses";
import { transitionOrderStatus } from "./updateOrderStatus";

type SupplierOrderAttemptRow = typeof supplierOrders.$inferSelect;

async function getOrderStatus(orderId: string): Promise<string> {
  const rows = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!rows[0]) throw new Error(`Order not found: ${orderId}`);
  return rows[0].status;
}

async function getLatestAttempt(orderId: string, supplierKey: string): Promise<SupplierOrderAttemptRow | null> {
  const rows = await db
    .select()
    .from(supplierOrders)
    .where(and(eq(supplierOrders.orderId, orderId), eq(supplierOrders.supplierKey, supplierKey)))
    .orderBy(desc(supplierOrders.attemptNo), desc(supplierOrders.updatedAt), desc(supplierOrders.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

async function createNewAttempt(input: {
  orderId: string;
  supplierKey: string;
  purchaseStatus: SupplierPurchaseStatus;
  actorId?: string;
  manualNote?: string | null;
  purchaseRecordedAt?: Date | null;
}): Promise<SupplierOrderAttemptRow> {
  const rows = await db
    .select({ maxAttemptNo: max(supplierOrders.attemptNo) })
    .from(supplierOrders)
    .where(and(eq(supplierOrders.orderId, input.orderId), eq(supplierOrders.supplierKey, input.supplierKey)));

  const nextAttemptNo = Number(rows[0]?.maxAttemptNo ?? 0) + 1;

  const inserted = await db
    .insert(supplierOrders)
    .values({
      orderId: input.orderId,
      supplierKey: input.supplierKey,
      attemptNo: nextAttemptNo,
      purchaseStatus: input.purchaseStatus,
      manualNote: input.manualNote ?? null,
      purchaseRecordedAt: input.purchaseRecordedAt ?? null,
      updatedAt: new Date(),
    })
    .returning();

  const row = inserted[0];

  await createOrderEvent({
    orderId: input.orderId,
    eventType: "PURCHASE_ATTEMPT_CREATED",
    details: {
      supplierKey: input.supplierKey,
      attemptNo: row.attemptNo,
      purchaseStatus: row.purchaseStatus,
      actorId: input.actorId ?? null,
    },
  });

  return row;
}

export async function recordSupplierPurchase(input: {
  orderId: string;
  supplierKey: string;
  supplierOrderRef?: string | null;
  purchaseStatus?: SupplierPurchaseStatus;
  manualNote?: string | null;
  actorId?: string;
  attemptNo?: number;
}) {
  const purchaseStatus = input.purchaseStatus ?? "SUBMITTED";
  if (!isSupplierPurchaseStatus(purchaseStatus)) {
    throw new Error(`Invalid supplier purchase status: ${purchaseStatus}`);
  }

  const now = new Date();
  const currentStatus = await getOrderStatus(input.orderId);
  const purchasableStates = new Set([
    "PURCHASE_APPROVED",
    "PURCHASE_PLACED",
    "TRACKING_PENDING",
    "TRACKING_RECEIVED",
    "TRACKING_SYNCED",
  ]);
  if (!purchasableStates.has(currentStatus)) {
    throw new Error(
      `Order ${input.orderId} must be PURCHASE_APPROVED (or later) before recording purchase. Current status: ${currentStatus}`
    );
  }

  if (currentStatus === "PURCHASE_APPROVED") {
    await transitionOrderStatus({
      orderId: input.orderId,
      nextStatus: "PURCHASE_PLACED",
      actorId: input.actorId,
      reason: "Manual supplier purchase recorded",
    });
  }

  let attempt: SupplierOrderAttemptRow | null = null;

  if (input.attemptNo != null) {
    const exact = await db
      .select()
      .from(supplierOrders)
      .where(
        and(
          eq(supplierOrders.orderId, input.orderId),
          eq(supplierOrders.supplierKey, input.supplierKey),
          eq(supplierOrders.attemptNo, input.attemptNo)
        )
      )
      .limit(1);
    attempt = exact[0] ?? null;
  } else {
    attempt = await getLatestAttempt(input.orderId, input.supplierKey);
  }

  if (!attempt) {
    attempt = await createNewAttempt({
      orderId: input.orderId,
      supplierKey: input.supplierKey,
      purchaseStatus,
      actorId: input.actorId,
      manualNote: input.manualNote,
      purchaseRecordedAt: now,
    });
  }

  const nextSupplierOrderRef = input.supplierOrderRef ?? attempt.supplierOrderRef ?? null;
  const nextManualNote = input.manualNote ?? attempt.manualNote ?? null;

  const hasChange =
    attempt.purchaseStatus !== purchaseStatus ||
    (attempt.supplierOrderRef ?? null) !== nextSupplierOrderRef ||
    (attempt.manualNote ?? null) !== nextManualNote ||
    attempt.purchaseRecordedAt == null;

  if (hasChange) {
    const updated = await db
      .update(supplierOrders)
      .set({
        purchaseStatus,
        supplierOrderRef: nextSupplierOrderRef,
        manualNote: nextManualNote,
        purchaseRecordedAt: attempt.purchaseRecordedAt ?? now,
        updatedAt: now,
      })
      .where(eq(supplierOrders.id, attempt.id))
      .returning();
    attempt = updated[0] ?? attempt;

    await createOrderEvent({
      orderId: input.orderId,
      eventType: "PURCHASE_PLACED_RECORDED",
      details: {
        supplierKey: input.supplierKey,
        attemptNo: attempt.attemptNo,
        supplierOrderRef: attempt.supplierOrderRef,
        purchaseStatus,
        actorId: input.actorId ?? null,
      },
    });
  }

  const orderStatusAfterPurchase = await getOrderStatus(input.orderId);
  if (orderStatusAfterPurchase === "PURCHASE_PLACED") {
    await transitionOrderStatus({
      orderId: input.orderId,
      nextStatus: "TRACKING_PENDING",
      actorId: input.actorId,
      reason: "Awaiting supplier tracking",
    });
  }

  return {
    orderId: input.orderId,
    supplierOrderId: attempt.id,
    attemptNo: attempt.attemptNo,
    purchaseStatus: attempt.purchaseStatus,
    supplierOrderRef: attempt.supplierOrderRef,
    changed: hasChange,
  };
}

export async function recordSupplierTracking(input: {
  orderId: string;
  supplierKey: string;
  trackingNumber: string;
  trackingStatus?: TrackingStatus;
  manualNote?: string | null;
  actorId?: string;
  supplierOrderId?: string;
}) {
  const trackingStatus = input.trackingStatus ?? "LABEL_CREATED";
  if (!isTrackingStatus(trackingStatus)) {
    throw new Error(`Invalid tracking status: ${trackingStatus}`);
  }
  const currentStatus = await getOrderStatus(input.orderId);
  const trackableStates = new Set([
    "PURCHASE_PLACED",
    "TRACKING_PENDING",
    "TRACKING_RECEIVED",
    "TRACKING_SYNCED",
  ]);
  if (!trackableStates.has(currentStatus)) {
    throw new Error(
      `Order ${input.orderId} must be PURCHASE_PLACED (or later) before recording tracking. Current status: ${currentStatus}`
    );
  }

  const targetRow = input.supplierOrderId
    ? (
        await db
          .select()
          .from(supplierOrders)
          .where(
            and(
              eq(supplierOrders.id, input.supplierOrderId),
              eq(supplierOrders.orderId, input.orderId),
              eq(supplierOrders.supplierKey, input.supplierKey)
            )
          )
          .limit(1)
      )[0] ?? null
    : await getLatestAttempt(input.orderId, input.supplierKey);

  if (!targetRow) {
    throw new Error(
      `No supplier purchase attempt found for order ${input.orderId} and supplier ${input.supplierKey}`
    );
  }

  const now = new Date();
  const nextManualNote = input.manualNote ?? targetRow.manualNote ?? null;
  const changed =
    (targetRow.trackingNumber ?? "") !== input.trackingNumber ||
    targetRow.trackingStatus !== trackingStatus ||
    (targetRow.manualNote ?? null) !== nextManualNote ||
    targetRow.trackingRecordedAt == null;

  if (changed) {
    await db
      .update(supplierOrders)
      .set({
        trackingNumber: input.trackingNumber,
        trackingStatus,
        trackingRecordedAt: targetRow.trackingRecordedAt ?? now,
        manualNote: nextManualNote,
        updatedAt: now,
      })
      .where(eq(supplierOrders.id, targetRow.id));

    await createOrderEvent({
      orderId: input.orderId,
      eventType: "TRACKING_RECORDED",
      details: {
        supplierKey: input.supplierKey,
        attemptNo: targetRow.attemptNo,
        trackingNumber: input.trackingNumber,
        trackingStatus,
        actorId: input.actorId ?? null,
      },
    });
  }

  if (currentStatus === "TRACKING_PENDING" || currentStatus === "PURCHASE_PLACED") {
    await transitionOrderStatus({
      orderId: input.orderId,
      nextStatus: "TRACKING_RECEIVED",
      actorId: input.actorId,
      reason: "Manual tracking recorded",
    });
  }

  return {
    orderId: input.orderId,
    supplierOrderId: targetRow.id,
    attemptNo: targetRow.attemptNo,
    trackingNumber: input.trackingNumber,
    trackingStatus,
    changed,
  };
}
