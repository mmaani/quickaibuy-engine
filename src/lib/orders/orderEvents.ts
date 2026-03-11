import { db } from "@/lib/db";
import { orderEvents } from "@/lib/db/schema";
import type { OrderEventType } from "./statuses";

export async function createOrderEvent(input: {
  orderId: string;
  eventType: OrderEventType;
  details?: Record<string, unknown> | null;
  eventTs?: Date;
}) {
  await db.insert(orderEvents).values({
    orderId: input.orderId,
    eventType: input.eventType,
    eventTs: input.eventTs ?? new Date(),
    details: input.details ?? null,
  });
}
