import { db } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { orderEvents, orderItems, orders } from "@/lib/db/schema";
import { fetchEbayOrders, type NormalizedEbayOrder } from "./ebayFetchOrders";

export type ListingLinkage = {
  listingId: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  linkageSource: string | null;
  linkageVerifiedAt: Date | null;
  linkageDeterministic: boolean;
  supplierLinkLocked: boolean;
  supplierStockStatus: string | null;
  supplierStockQty: number | null;
  stockVerifiedAt: Date | null;
  stockSource: string | null;
  stockCheckRequired: boolean;
};

export type OrderItemComparable = {
  listingId: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  linkageSource: string | null;
  linkageVerifiedAt: Date | null;
  linkageDeterministic: boolean;
  supplierLinkLocked: boolean;
  supplierStockStatus: string | null;
  supplierStockQty: number | null;
  stockVerifiedAt: Date | null;
  stockSource: string | null;
  stockCheckRequired: boolean;
  quantity: number;
  itemPrice: string;
};

export type OrderSyncChange = "created" | "updated" | "unchanged";

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

function getLegacyOrderQuantity(order: NormalizedEbayOrder): number {
  return order.lineItems.reduce((sum, item) => sum + Math.max(1, Math.trunc(item.quantity || 0)), 0) || 1;
}

function getLegacyListingId(items: OrderItemComparable[]): string | null {
  if (items.length !== 1) return null;
  return items[0].listingId ?? null;
}

function buildLegacyRawPayload(order: NormalizedEbayOrder): Record<string, unknown> {
  return {
    marketplace: order.marketplace,
    marketplaceOrderId: order.marketplaceOrderId,
    sourceStatus: order.sourceStatus,
    buyerName: order.buyerName,
    buyerCountry: order.buyerCountry,
    buyerPhone: order.buyerPhone,
    buyerEmail: order.buyerEmail,
    shippingAddress: order.shippingAddress,
    lineItems: order.lineItems,
  };
}

function comparableItemKey(item: OrderItemComparable): string {
  return [
    item.listingId ?? "",
    item.supplierKey ?? "",
    item.supplierProductId ?? "",
    item.linkageSource ?? "",
    item.linkageVerifiedAt?.toISOString() ?? "",
    String(item.linkageDeterministic),
    String(item.supplierLinkLocked),
    item.supplierStockStatus ?? "",
    item.supplierStockQty == null ? "" : String(item.supplierStockQty),
    item.stockVerifiedAt?.toISOString() ?? "",
    item.stockSource ?? "",
    String(item.stockCheckRequired),
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
      linkageSource: linkage?.linkageSource ?? null,
      linkageVerifiedAt: linkage?.linkageVerifiedAt ?? null,
      linkageDeterministic: Boolean(linkage?.linkageDeterministic),
      supplierLinkLocked: Boolean(linkage?.supplierLinkLocked),
      supplierStockStatus: linkage?.supplierStockStatus ?? null,
      supplierStockQty: linkage?.supplierStockQty ?? null,
      stockVerifiedAt: linkage?.stockVerifiedAt ?? null,
      stockSource: linkage?.stockSource ?? null,
      stockCheckRequired: Boolean(linkage?.stockCheckRequired),
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
    linkageSource: string | null;
    linkageVerifiedAt: Date | null;
    linkageDeterministic: boolean;
    supplierLinkLocked: boolean;
    supplierStockStatus: string | null;
    supplierStockQty: number | null;
    stockVerifiedAt: Date | null;
    stockSource: string | null;
    stockCheckRequired: boolean;
  }>(sql`
    SELECT
      l.published_external_id AS "listingExternalId",
      l.id AS "listingId",
      COALESCE(
        NULLIF(BTRIM(pc.supplier_key), ''),
        NULLIF(BTRIM(l.payload -> 'source' ->> 'supplierKey'), '')
      ) AS "supplierKey",
      COALESCE(
        NULLIF(BTRIM(pc.supplier_product_id), ''),
        NULLIF(BTRIM(l.payload -> 'source' ->> 'supplierProductId'), '')
      ) AS "supplierProductId",
      l.linkage_source AS "linkageSource",
      l.linkage_verified_at AS "linkageVerifiedAt",
      l.linkage_deterministic AS "linkageDeterministic",
      l.supplier_link_locked AS "supplierLinkLocked",
      l.supplier_stock_status AS "supplierStockStatus",
      l.supplier_stock_qty AS "supplierStockQty",
      l.stock_verified_at AS "stockVerifiedAt",
      l.stock_source AS "stockSource",
      l.stock_check_required AS "stockCheckRequired"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE LOWER(l.marketplace_key) = 'ebay'
      AND l.published_external_id IN (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})
      AND l.status IN ('ACTIVE', 'PUBLISH_IN_PROGRESS', 'READY_TO_PUBLISH', 'PREVIEW')
      AND l.linkage_deterministic = TRUE
      AND l.supplier_link_locked = TRUE
    ORDER BY l.updated_at DESC NULLS LAST
  `);

  const map = new Map<string, ListingLinkage>();
  for (const row of rows.rows ?? []) {
    if (!row.listingExternalId || map.has(row.listingExternalId)) continue;
    map.set(row.listingExternalId, {
      listingId: row.listingId ?? null,
      supplierKey: row.supplierKey ?? null,
      supplierProductId: row.supplierProductId ?? null,
      linkageSource: row.linkageSource ?? null,
      linkageVerifiedAt: row.linkageVerifiedAt ?? null,
      linkageDeterministic: Boolean(row.linkageDeterministic),
      supplierLinkLocked: Boolean(row.supplierLinkLocked),
      supplierStockStatus: row.supplierStockStatus ?? null,
      supplierStockQty: row.supplierStockQty == null ? null : Number(row.supplierStockQty),
      stockVerifiedAt: row.stockVerifiedAt ?? null,
      stockSource: row.stockSource ?? null,
      stockCheckRequired: Boolean(row.stockCheckRequired),
    });
  }
  return map;
}

export async function upsertNormalizedEbayOrder(
  order: NormalizedEbayOrder,
  listingLinkages: Map<string, ListingLinkage>
): Promise<OrderSyncChange> {
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
    let changeType: OrderSyncChange;
    let createOrderSyncedEvent = false;
    const incomingComparableItems = toComparableIncomingItems(order, listingLinkages);

    if (!existingRow) {
      const inserted = await tx
        .insert(orders)
        .values({
          legacyListingId: getLegacyListingId(incomingComparableItems),
          legacyMarketplaceKey: "ebay",
          legacyOrderId: order.marketplaceOrderId,
          marketplace: "ebay",
          marketplaceOrderId: order.marketplaceOrderId,
          buyerName: order.buyerName,
          buyerCountry: order.buyerCountry,
          legacyQuantity: getLegacyOrderQuantity(order),
          legacyTotalAmount: order.totalPrice == null ? null : String(order.totalPrice),
          legacyRawPayload: buildLegacyRawPayload(order),
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
      const nextPersistedStatus =
        existingRow.status === "NEW" || existingRow.status === "SYNCED"
          ? nextStatus
          : existingRow.status;
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
          linkageSource: orderItems.linkageSource,
          linkageVerifiedAt: orderItems.linkageVerifiedAt,
          linkageDeterministic: orderItems.linkageDeterministic,
          supplierLinkLocked: orderItems.supplierLinkLocked,
          supplierStockStatus: orderItems.supplierStockStatus,
          supplierStockQty: orderItems.supplierStockQty,
          stockVerifiedAt: orderItems.stockVerifiedAt,
          stockSource: orderItems.stockSource,
          stockCheckRequired: orderItems.stockCheckRequired,
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
      const statusChanged = nextPersistedStatus !== existingRow.status;

      if (orderFieldsChanged || statusChanged) {
        await tx
          .update(orders)
          .set({
            legacyListingId: getLegacyListingId(incomingComparableItems),
            legacyMarketplaceKey: "ebay",
            legacyOrderId: order.marketplaceOrderId,
            buyerName: order.buyerName ?? existingRow.buyerName,
            buyerCountry: order.buyerCountry ?? existingRow.buyerCountry,
            legacyQuantity: getLegacyOrderQuantity(order),
            legacyTotalAmount:
              order.totalPrice == null
                ? existingRow.totalPrice
                : String(order.totalPrice),
            legacyRawPayload: buildLegacyRawPayload(order),
            totalPrice:
              order.totalPrice == null
                ? existingRow.totalPrice
                : String(order.totalPrice),
            currency: newCurrency || existingRow.currency,
            status: nextPersistedStatus,
            updatedAt: now,
          })
          .where(eq(orders.id, orderId));
      }

      changeType = orderFieldsChanged || lineItemsChanged || statusChanged ? "updated" : "unchanged";

      if (lineItemsChanged) {
        await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));

        if (incomingComparableItems.length > 0) {
          await tx.insert(orderItems).values(
            incomingComparableItems.map((item) => ({
              orderId,
              listingId: item.listingId,
              supplierKey: item.supplierKey,
              supplierProductId: item.supplierProductId,
              linkageSource: item.linkageSource,
              linkageVerifiedAt: item.linkageVerifiedAt,
              linkageDeterministic: item.linkageDeterministic,
              supplierLinkLocked: item.supplierLinkLocked,
              supplierStockStatus: item.supplierStockStatus,
              supplierStockQty: item.supplierStockQty,
              stockVerifiedAt: item.stockVerifiedAt,
              stockSource: item.stockSource,
              stockCheckRequired: item.stockCheckRequired,
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
      const change = await upsertNormalizedEbayOrder(order, linkages);
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
