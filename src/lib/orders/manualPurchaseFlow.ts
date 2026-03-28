import { and, desc, eq, max } from "drizzle-orm";
import { Queue } from "bullmq";
import { db } from "@/lib/db";
import { orderItems, orders, supplierOrders } from "@/lib/db/schema";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";
import { createOrderEvent } from "./orderEvents";
import { evaluateSupplierSelectionAgainstPinnedLinkage, normalizeSupplierKeyForSelection } from "./supplierSelectionSafety";
import {
  canRecordSupplierPurchaseForOrderStatus,
  canRecordTrackingForOrderStatus,
  isOrderStatus,
  isSupplierPurchaseStatus,
  isTrackingStatus,
  ORDER_STATUS,
  type OrderStatus,
  type SupplierPurchaseStatus,
  type TrackingStatus,
} from "./statuses";
import { transitionOrderStatus } from "./updateOrderStatus";

type SupplierOrderAttemptRow = typeof supplierOrders.$inferSelect;

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

function normalizeSupplierKey(value: string): string {
  return normalizeSupplierKeyForSelection(value);
}

async function assertSupplierMatchesPinnedOrderLinkage(input: { orderId: string; supplierKey: string }) {
  const rows = await db
    .select({
      supplierKey: orderItems.supplierKey,
      linkageDeterministic: orderItems.linkageDeterministic,
      supplierLinkLocked: orderItems.supplierLinkLocked,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, input.orderId));

  const blockReason = evaluateSupplierSelectionAgainstPinnedLinkage({
    orderItemLinkages: rows,
    requestedSupplierKey: input.supplierKey,
  });
  if (blockReason) {
    if (blockReason === "SUPPLIER_SUBSTITUTION_BLOCKED") {
      throw new Error("SUPPLIER_SUBSTITUTION_BLOCKED: order has ambiguous supplier linkage");
    }
    if (blockReason === "SUPPLIER_FALLBACK_BLOCKED") {
      throw new Error("SUPPLIER_FALLBACK_BLOCKED: supplier does not match pinned order linkage");
    }
    if (blockReason === "SUPPLIER_LINK_NOT_LOCKED") {
      throw new Error("SUPPLIER_LINK_NOT_LOCKED");
    }
    throw new Error(`${blockReason}: order has no pinned order items`);
  }
}

async function assertSupplierMatchesPinnedOrderLinkage(input: { orderId: string; supplierKey: string }) {
  const rows = await db
    .select({
      supplierKey: orderItems.supplierKey,
      linkageDeterministic: orderItems.linkageDeterministic,
      supplierLinkLocked: orderItems.supplierLinkLocked,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, input.orderId));

  if (!rows.length) throw new Error("SUPPLIER_FALLBACK_BLOCKED: order has no pinned order items");
  const pinnedSupplierKeys = Array.from(
    new Set(rows.map((row) => String(row.supplierKey ?? "").trim().toLowerCase()).filter(Boolean))
  );
  if (pinnedSupplierKeys.length !== 1) {
    throw new Error("SUPPLIER_SUBSTITUTION_BLOCKED: order has ambiguous supplier linkage");
  }
  if (pinnedSupplierKeys[0] !== normalizeSupplierKey(input.supplierKey)) {
    throw new Error("SUPPLIER_FALLBACK_BLOCKED: supplier does not match pinned order linkage");
  }
  if (rows.some((row) => !row.linkageDeterministic || !row.supplierLinkLocked)) {
    throw new Error("SUPPLIER_LINK_NOT_LOCKED");
  }
}

async function getOrderStatus(orderId: string): Promise<OrderStatus> {
  const rows = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!rows[0]) throw new Error(`Order not found: ${orderId}`);
  const status = rows[0].status;
  if (!isOrderStatus(status)) {
    throw new Error(`Unsupported order status on row ${orderId}: ${status}`);
  }
  return status;
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
  await assertSupplierMatchesPinnedOrderLinkage({ orderId: input.orderId, supplierKey: input.supplierKey });
  if (!isSupplierPurchaseStatus(purchaseStatus)) {
    throw new Error(`Invalid supplier purchase status: ${purchaseStatus}`);
  }

  const now = new Date();
  const currentStatus = await getOrderStatus(input.orderId);
  if (!canRecordSupplierPurchaseForOrderStatus(currentStatus)) {
    throw new Error(
      `Order ${input.orderId} is not eligible for supplier purchase recording. Current status: ${currentStatus}`
    );
  }

  if (
    currentStatus === ORDER_STATUS.MANUAL_REVIEW ||
    currentStatus === ORDER_STATUS.READY_FOR_PURCHASE_REVIEW ||
    currentStatus === ORDER_STATUS.PURCHASE_APPROVED
  ) {
    await transitionOrderStatus({
      orderId: input.orderId,
      nextStatus: ORDER_STATUS.PURCHASE_PLACED,
      actorId: input.actorId,
      reason:
        currentStatus === ORDER_STATUS.PURCHASE_APPROVED
          ? "Manual supplier purchase recorded"
          : "Manual supplier purchase recorded while order remained in review",
      details:
        currentStatus === ORDER_STATUS.PURCHASE_APPROVED
          ? undefined
          : {
              purchaseRecordedWithoutApproval: true,
              previousWorkflowStatus: currentStatus,
            },
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
  if (orderStatusAfterPurchase === ORDER_STATUS.PURCHASE_PLACED) {
    await transitionOrderStatus({
      orderId: input.orderId,
      nextStatus: ORDER_STATUS.TRACKING_PENDING,
      actorId: input.actorId,
      reason: "Awaiting supplier tracking",
    });
  }

  if (
    normalizeSupplierKey(input.supplierKey) === "cjdropshipping" &&
    attempt.supplierOrderRef
  ) {
    const payload = {
      orderId: input.orderId,
      supplierOrderId: attempt.id,
      actorId: input.actorId ?? "recordSupplierPurchase",
    };
    const job = await jobsQueue.add(JOB_NAMES.TRACKING_SYNC, payload, {
      jobId: `tracking-sync-${attempt.id}`,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });

    await markJobQueued({
      jobType: JOB_NAMES.TRACKING_SYNC,
      idempotencyKey: String(job.id),
      payload,
      attempt: 0,
      maxAttempts: 3,
    });

    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "TRACKING_SYNC_QUEUED",
        actorId: input.actorId ?? null,
        supplierOrderId: attempt.id,
        jobId: String(job.id),
      },
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
  trackingCarrier?: string | null;
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
  if (!canRecordTrackingForOrderStatus(currentStatus)) {
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
  const nextTrackingCarrier = input.trackingCarrier ?? targetRow.trackingCarrier ?? null;
  const changed =
    (targetRow.trackingNumber ?? "") !== input.trackingNumber ||
    (targetRow.trackingCarrier ?? null) !== nextTrackingCarrier ||
    targetRow.trackingStatus !== trackingStatus ||
    (targetRow.manualNote ?? null) !== nextManualNote ||
    targetRow.trackingRecordedAt == null;

  if (changed) {
    await db
      .update(supplierOrders)
      .set({
        trackingNumber: input.trackingNumber,
        trackingCarrier: nextTrackingCarrier,
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
        trackingCarrier: nextTrackingCarrier,
        trackingStatus,
        actorId: input.actorId ?? null,
      },
    });
  }

  if (
    currentStatus === ORDER_STATUS.TRACKING_PENDING ||
    currentStatus === ORDER_STATUS.PURCHASE_PLACED
  ) {
    await transitionOrderStatus({
      orderId: input.orderId,
      nextStatus: ORDER_STATUS.TRACKING_RECEIVED,
      actorId: input.actorId,
      reason: "Manual tracking recorded",
    });
  }

  return {
    orderId: input.orderId,
    supplierOrderId: targetRow.id,
    attemptNo: targetRow.attemptNo,
    trackingNumber: input.trackingNumber,
    trackingCarrier: nextTrackingCarrier,
    trackingStatus,
    changed,
  };
}
