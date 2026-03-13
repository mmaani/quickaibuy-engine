import { db } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { orderEvents, orderItems, orders } from "@/lib/db/schema";
import { fetchEbayOrders, type NormalizedEbayOrder } from "./ebayFetchOrders";

type ListingLinkage = {
  listingId: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
};

type OrderItemComparable = {
  listingId: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  quantity: number;
  itemPrice: string;
};

export type SyncEbayOrdersResult = {
  ok: boolean;
  fetched: number;
  normalized: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
};

function asCurrency(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length ? trimmed : null;
}

function hasMeaningfulChange(existing: {
  buyerName: string | null;
  buyerCountry: string | null;
  totalPrice: string | null;
  currency: string | null;
}, incoming: NormalizedEbayOrder): boolean {
  const incomingTotal = incoming.totalPrice == null ? null : String(incoming.totalPrice);
  return (
    (incoming.buyerName != null && incoming.buyerName !== existing.buyerName) ||
    (incoming.buyerCountry != null && incoming.buyerCountry !== existing.buyerCountry) ||
    (incomingTotal != null && incomingTotal !== existing.totalPrice) ||
    (incoming.currency != null && incoming.currency !== existing.currency)
  );
}

function normalizeItemPrice(value: string | number | null): string {
  return value == null ? "0" : String(value);
}

function comparableItemKey(item: OrderItemComparable): string {
  return [
    item.listingId ?? "",
    item.supplierKey ?? "",
    item.supplierProductId ?? "",
    String(item.quantity),
    item.itemPrice,
  ].join("|");
}

function toComparableIncomingItems(
  order: NormalizedEbayOrder,
  listingLinkages: Map<string, ListingLinkage>
): OrderItemComparable[] {
  return order.lineItems.map((item) => {
    const linkage = item.listingExternalId
      ? (listingLinkages.get(item.listingExternalId) ?? null)
      : null;
    return {
      listingId: linkage?.listingId ?? null,
      supplierKey: linkage?.supplierKey ?? null,
      supplierProductId: linkage?.supplierProductId ?? null,
      quantity: item.quantity,
      itemPrice: normalizeItemPrice(item.itemPrice),
    };
  });
}

function hasLineItemChange(
  existingItems: OrderItemComparable[],
  incomingItems: OrderItemComparable[]
): boolean {
  if (existingItems.length !== incomingItems.length) return true;

  const counts = new Map<string, number>();
  for (const item of existingItems) {
    const key = comparableItemKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const item of incomingItems) {
    const key = comparableItemKey(item);
    const current = counts.get(key);
    if (!current) return true;
    if (current === 1) counts.delete(key);
    else counts.set(key, current - 1);
  }

  return counts.size > 0;
}

async function resolveListingLinkages(
  listingExternalIds: string[]
): Promise<Map<string, ListingLinkage>> {
  const unique = Array.from(new Set(listingExternalIds.filter(Boolean)));
  if (!unique.length) return new Map();

  const rows = await db.execute<{
    listingExternalId: string;
    listingId: string;
    supplierKey: string | null;
    supplierProductId: string | null;
  }>(sql`
    SELECT
      l.published_external_id AS "listingExternalId",
      l.id AS "listingId",
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE LOWER(l.marketplace_key) = 'ebay'
      AND l.published_external_id IN (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})
      AND l.status IN ('ACTIVE', 'PUBLISH_IN_PROGRESS', 'READY_TO_PUBLISH', 'PREVIEW')
    ORDER BY l.updated_at DESC NULLS LAST
  `);

  const map = new Map<string, ListingLinkage>();
  for (const row of rows.rows ?? []) {
    if (!row.listingExternalId || map.has(row.listingExternalId)) continue;
    map.set(row.listingExternalId, {
      listingId: row.listingId ?? null,
      supplierKey: row.supplierKey ?? null,
      supplierProductId: row.supplierProductId ?? null,
    });
  }
  return map;
}

async function upsertOneOrder(
  order: NormalizedEbayOrder,
  listingLinkages: Map<string, ListingLinkage>
): Promise<"created" | "updated" | "unchanged"> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: orders.id,
        status: orders.status,
        buyerName: orders.buyerName,
        buyerCountry: orders.buyerCountry,
        totalPrice: orders.totalPrice,
        currency: orders.currency,
      })
      .from(orders)
      .where(
        and(
          eq(orders.marketplace, "ebay"),
          eq(orders.marketplaceOrderId, order.marketplaceOrderId)
        )
      )
      .limit(1);

    const existingRow = existing[0];
    const newCurrency = asCurrency(order.currency) ?? "USD";
    const nextStatus = "MANUAL_REVIEW";
    const now = new Date();
    let orderId: string;
    let changeType: "created" | "updated" | "unchanged";
    let createOrderSyncedEvent = false;
    const incomingComparableItems = toComparableIncomingItems(order, listingLinkages);

    if (!existingRow) {
      const inserted = await tx
        .insert(orders)
        .values({
          marketplace: "ebay",
          marketplaceOrderId: order.marketplaceOrderId,
          buyerName: order.buyerName,
          buyerCountry: order.buyerCountry,
          totalPrice: order.totalPrice == null ? null : String(order.totalPrice),
          currency: newCurrency,
          status: nextStatus,
          createdAt: order.createdAt,
          updatedAt: now,
        })
        .returning({ id: orders.id });
      orderId = inserted[0].id;
      changeType = "created";
      createOrderSyncedEvent = true;
    } else {
      orderId = existingRow.id;
      const orderFieldsChanged = hasMeaningfulChange(
        {
          buyerName: existingRow.buyerName,
          buyerCountry: existingRow.buyerCountry,
          totalPrice: existingRow.totalPrice == null ? null : String(existingRow.totalPrice),
          currency: existingRow.currency,
        },
        order
      );

      const existingItems = await tx
        .select({
          listingId: orderItems.listingId,
          supplierKey: orderItems.supplierKey,
          supplierProductId: orderItems.supplierProductId,
          quantity: orderItems.quantity,
          itemPrice: orderItems.itemPrice,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      const lineItemsChanged = hasLineItemChange(
        existingItems.map((item) => ({
          ...item,
          itemPrice: normalizeItemPrice(item.itemPrice),
        })),
        incomingComparableItems
      );

      await tx
        .update(orders)
        .set({
          buyerName: order.buyerName ?? existingRow.buyerName,
          buyerCountry: order.buyerCountry ?? existingRow.buyerCountry,
          totalPrice:
            order.totalPrice == null
              ? existingRow.totalPrice
              : String(order.totalPrice),
          currency: newCurrency || existingRow.currency,
          status:
            existingRow.status === "NEW" ||
            existingRow.status === "SYNCED" ||
            existingRow.status === "MANUAL_REVIEW"
              ? nextStatus
              : existingRow.status,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId));

      changeType = orderFieldsChanged || lineItemsChanged ? "updated" : "unchanged";

      if (lineItemsChanged) {
        await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));

        if (incomingComparableItems.length > 0) {
          await tx.insert(orderItems).values(
            incomingComparableItems.map((item) => ({
              orderId,
              listingId: item.listingId,
              supplierKey: item.supplierKey,
              supplierProductId: item.supplierProductId,
              quantity: item.quantity,
              itemPrice: item.itemPrice,
            }))
          );
        }
      }
    }

    if (!existingRow && incomingComparableItems.length > 0) {
      await tx.insert(orderItems).values(
        incomingComparableItems.map((item) => ({
          orderId,
          listingId: item.listingId,
          supplierKey: item.supplierKey,
          supplierProductId: item.supplierProductId,
          quantity: item.quantity,
          itemPrice: item.itemPrice,
        }))
      );
    }

    if (createOrderSyncedEvent) {
      await tx.insert(orderEvents).values({
        orderId,
        eventType: "ORDER_SYNCED",
        details: {
          marketplace: "ebay",
          marketplaceOrderId: order.marketplaceOrderId,
          sourceStatus: order.sourceStatus,
          itemCount: order.lineItems.length,
        },
      });
    } else if (changeType === "updated") {
      await tx.insert(orderEvents).values({
        orderId,
        eventType: "STATUS_CHANGED",
        details: {
          marketplace: "ebay",
          marketplaceOrderId: order.marketplaceOrderId,
          note: "Order or line items updated during sync",
        },
      });
    }

    return changeType;
  });
}

export async function syncEbayOrders(input?: {
  limit?: number;
  lookbackHours?: number;
  actorId?: string;
}): Promise<SyncEbayOrdersResult> {
  const actorId = input?.actorId ?? "orderSync.worker";
  const fetched = await fetchEbayOrders({
    limit: input?.limit,
    lookbackHours: input?.lookbackHours,
  });

  const listingIds = fetched.orders
    .flatMap((order) => order.lineItems.map((item) => item.listingExternalId))
    .filter((v): v is string => Boolean(v));
  const linkages = await resolveListingLinkages(listingIds);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const order of fetched.orders) {
    try {
      const change = await upsertOneOrder(order, linkages);
      if (change === "created") created++;
      else if (change === "updated") updated++;
      else unchanged++;
    } catch (error) {
      failed++;
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "ORDER",
        entityId: order.marketplaceOrderId,
        eventType: "ORDER_SYNC_FAILED",
        details: {
          marketplace: "ebay",
          marketplaceOrderId: order.marketplaceOrderId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  await writeAuditLog({
    actorType: "WORKER",
    actorId,
    entityType: "ORDER",
    entityId: "batch",
    eventType: "ORDER_SYNC_RUN_COMPLETED",
    details: {
      marketplace: "ebay",
      fetched: fetched.fetchedCount,
      normalized: fetched.normalizedCount,
      created,
      updated,
      unchanged,
      failed,
      lookbackHours: fetched.lookbackHours,
      limit: fetched.limit,
    },
  });

  return {
    ok: failed === 0,
    fetched: fetched.fetchedCount,
    normalized: fetched.normalizedCount,
    created,
    updated,
    unchanged,
    failed,
  };
}
