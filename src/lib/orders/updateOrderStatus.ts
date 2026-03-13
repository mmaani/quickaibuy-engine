import { db } from "@/lib/db";
import { orderEvents, orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createOrderEvent } from "./orderEvents";
import { assertOrderPurchaseSafetyForApproval } from "./purchaseSafety";
import { canTransitionOrderStatus } from "./transitions";
import { isOrderStatus, ORDER_STATUS, type OrderStatus } from "./statuses";

export type TransitionOrderStatusResult = {
  changed: boolean;
  orderId: string;
  previousStatus: OrderStatus;
  nextStatus: OrderStatus;
};

export async function transitionOrderStatus(input: {
  orderId: string;
  nextStatus: OrderStatus;
  actorId?: string;
  reason?: string;
  details?: Record<string, unknown>;
}): Promise<TransitionOrderStatusResult> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new Error(`Order not found: ${input.orderId}`);
    }
    if (!isOrderStatus(row.status)) {
      throw new Error(`Unsupported order status on row ${input.orderId}: ${row.status}`);
    }

    const previousStatus = row.status;
    const nextStatus = input.nextStatus;

    if (previousStatus === nextStatus) {
      return {
        changed: false,
        orderId: row.id,
        previousStatus,
        nextStatus,
      };
    }

    if (!canTransitionOrderStatus(previousStatus, nextStatus)) {
      throw new Error(`Invalid order status transition: ${previousStatus} -> ${nextStatus}`);
    }

    await tx
      .update(orders)
      .set({
        status: nextStatus,
        updatedAt: now,
      })
      .where(eq(orders.id, input.orderId));

    await tx.insert(orderEvents).values({
      orderId: input.orderId,
      eventType: "STATUS_CHANGED",
      eventTs: now,
      details: {
        previousStatus,
        nextStatus,
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
        ...(input.details ?? {}),
      },
    });

    return {
      changed: true,
      orderId: row.id,
      previousStatus,
      nextStatus,
    };
  });
}

export async function setOrderReadyForPurchaseReview(input: {
  orderId: string;
  actorId?: string;
  reason?: string;
}) {
  const result = await transitionOrderStatus({
    orderId: input.orderId,
    nextStatus: ORDER_STATUS.READY_FOR_PURCHASE_REVIEW,
    actorId: input.actorId,
    reason: input.reason ?? "Marked ready for manual purchase review",
  });

  if (result.changed) {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "READY_FOR_PURCHASE_REVIEW",
        actorId: input.actorId ?? null,
      },
    });
  }

  return result;
}

export async function approveOrderForPurchase(input: {
  orderId: string;
  actorId?: string;
  reason?: string;
}) {
  const safetyStatus = await assertOrderPurchaseSafetyForApproval({
    orderId: input.orderId,
    actorId: input.actorId,
  });

  const result = await transitionOrderStatus({
    orderId: input.orderId,
    nextStatus: ORDER_STATUS.PURCHASE_APPROVED,
    actorId: input.actorId,
    reason: input.reason ?? "Purchase approved for manual placement",
    details: {
      purchaseSafetyStatus: safetyStatus.status,
      purchaseSafetyReasons: safetyStatus.reasons,
      purchaseSafetyCheckedAt: safetyStatus.checkedAt,
    },
  });

  if (result.changed) {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "PURCHASE_APPROVED",
        actorId: input.actorId ?? null,
      },
    });
  }

  return result;
}
