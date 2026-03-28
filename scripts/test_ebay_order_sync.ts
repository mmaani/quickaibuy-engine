import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderEvents, orderItems, orders } from "@/lib/db/schema";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";
import {
  upsertNormalizedEbayOrder,
  type ListingLinkage,
} from "@/lib/orders/syncEbayOrders";
import type { NormalizedEbayOrder } from "@/lib/orders/ebayFetchOrders";

loadRuntimeEnv();

const MARKETPLACE_ORDER_ID = "test-ebay-order-sync-optimization";
const LISTING_EXTERNAL_ID = "test-ebay-listing-sync-optimization";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup() {
  await db
    .delete(orders)
    .where(
      and(
        eq(orders.marketplace, "ebay"),
        eq(orders.marketplaceOrderId, MARKETPLACE_ORDER_ID)
      )
    );
}

function buildOrder(input?: {
  quantity?: number;
  itemPrice?: number;
  buyerName?: string;
}): NormalizedEbayOrder {
  return {
    marketplace: "ebay",
    marketplaceOrderId: MARKETPLACE_ORDER_ID,
    buyerName: input?.buyerName ?? "Sync Test Buyer",
    buyerCountry: "US",
    shippingAddress: {
      countryCode: "US",
      addressLine1: "123 Test St",
      addressLine2: null,
      city: "Austin",
      stateOrProvince: "TX",
      postalCode: "78701",
      county: null,
    },
    buyerPhone: "15555550123",
    buyerEmail: "sync-test@example.com",
    totalPrice: input?.itemPrice ?? 19.99,
    currency: "USD",
    createdAt: new Date("2026-03-13T00:00:00.000Z"),
    sourceStatus: "PAID",
    lineItems: [
      {
        marketplaceOrderItemId: "line-1",
        listingExternalId: LISTING_EXTERNAL_ID,
        quantity: input?.quantity ?? 1,
        itemPrice: input?.itemPrice ?? 19.99,
      },
    ],
  };
}

async function getOrderState() {
  const orderRows = await db
    .select({
      id: orders.id,
      status: orders.status,
      buyerName: orders.buyerName,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.marketplace, "ebay"),
        eq(orders.marketplaceOrderId, MARKETPLACE_ORDER_ID)
      )
    )
    .limit(1);

  const orderRow = orderRows[0];
  assert(orderRow, `Order not found for ${MARKETPLACE_ORDER_ID}`);

  const itemRows = await db
    .select({
      id: orderItems.id,
      listingId: orderItems.listingId,
      supplierKey: orderItems.supplierKey,
      supplierProductId: orderItems.supplierProductId,
      quantity: orderItems.quantity,
      itemPrice: orderItems.itemPrice,
      createdAt: orderItems.createdAt,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderRow.id))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

  const eventRows = await db
    .select({
      eventType: orderEvents.eventType,
      eventTs: orderEvents.eventTs,
    })
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderRow.id))
    .orderBy(asc(orderEvents.eventTs), asc(orderEvents.id));

  return {
    order: {
      ...orderRow,
      updatedAt: orderRow.updatedAt?.toISOString?.() ?? String(orderRow.updatedAt),
    },
    items: itemRows.map((row) => ({
      ...row,
      itemPrice: String(row.itemPrice),
      createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt),
    })),
    events: eventRows.map((row) => ({
      eventType: row.eventType,
      eventTs: row.eventTs?.toISOString?.() ?? String(row.eventTs),
    })),
  };
}

async function main() {
  await cleanup();

  const listingLinkages = new Map<string, ListingLinkage>([
    [
      LISTING_EXTERNAL_ID,
      {
        listingId: null,
        supplierKey: "sync-test-supplier",
        supplierProductId: "sync-test-product",
        linkageSource: "test",
        linkageVerifiedAt: new Date(),
        linkageDeterministic: true,
        supplierLinkLocked: true,
        supplierStockStatus: "IN_STOCK",
        supplierStockQty: 5,
        stockVerifiedAt: new Date(),
        stockSource: "test",
        stockCheckRequired: true,
      },
    ],
  ]);

  const firstChange = await upsertNormalizedEbayOrder(buildOrder(), listingLinkages);
  const firstState = await getOrderState();

  const secondChange = await upsertNormalizedEbayOrder(buildOrder(), listingLinkages);
  const secondState = await getOrderState();

  const thirdChange = await upsertNormalizedEbayOrder(
    buildOrder({ quantity: 2, itemPrice: 24.99 }),
    listingLinkages
  );
  const thirdState = await getOrderState();

  assert(firstChange === "created", `Expected first sync to create order, got ${firstChange}`);
  assert(secondChange === "unchanged", `Expected unchanged second sync, got ${secondChange}`);
  assert(thirdChange === "updated", `Expected changed third sync, got ${thirdChange}`);

  assert(firstState.items.length === 1, `Expected 1 item after first sync, got ${firstState.items.length}`);
  assert(secondState.items.length === 1, `Expected 1 item after unchanged sync, got ${secondState.items.length}`);
  assert(thirdState.items.length === 1, `Expected 1 item after changed sync, got ${thirdState.items.length}`);

  assert(
    firstState.items[0].id === secondState.items[0].id,
    "Unchanged sync rewrote order_items row id"
  );
  assert(
    firstState.items[0].createdAt === secondState.items[0].createdAt,
    "Unchanged sync rewrote order_items created_at"
  );
  assert(
    firstState.order.updatedAt === secondState.order.updatedAt,
    "Unchanged sync rewrote parent order row"
  );

  assert(
    thirdState.items[0].id !== secondState.items[0].id,
    "Changed sync did not replace order_items row"
  );
  assert(thirdState.items[0].quantity === 2, "Changed sync did not persist new quantity");
  assert(thirdState.items[0].itemPrice === "24.99", "Changed sync did not persist new item price");

  const eventTypesAfterSecond = secondState.events.map((row) => row.eventType);
  const eventTypesAfterThird = thirdState.events.map((row) => row.eventType);

  assert(
    JSON.stringify(eventTypesAfterSecond) === JSON.stringify(["ORDER_SYNCED"]),
    `Unexpected events after unchanged sync: ${eventTypesAfterSecond.join(", ")}`
  );
  assert(
    JSON.stringify(eventTypesAfterThird) === JSON.stringify(["ORDER_SYNCED", "STATUS_CHANGED"]),
    `Unexpected events after changed sync: ${eventTypesAfterThird.join(", ")}`
  );

  console.log(
    JSON.stringify(
      {
        changes: {
          first: firstChange,
          second: secondChange,
          third: thirdChange,
        },
        unchangedCheck: {
          itemRowIdPreserved: firstState.items[0].id === secondState.items[0].id,
          itemCreatedAtPreserved: firstState.items[0].createdAt === secondState.items[0].createdAt,
          orderUpdatedAtPreserved: firstState.order.updatedAt === secondState.order.updatedAt,
        },
        changedCheck: {
          itemRowReplaced: thirdState.items[0].id !== secondState.items[0].id,
          newQuantity: thirdState.items[0].quantity,
          newItemPrice: thirdState.items[0].itemPrice,
        },
        eventTypes: {
          afterFirst: firstState.events.map((row) => row.eventType),
          afterSecond: eventTypesAfterSecond,
          afterThird: eventTypesAfterThird,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  })
  .finally(async () => {
    await cleanup();
  });
