import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { listings, orderItems, orders, supplierOrders } from "@/lib/db/schema";

type OrderStatus = typeof orders.$inferSelect["status"];
type SupplierOrderRow = typeof supplierOrders.$inferSelect;

type TrackingSyncAttemptSelector = {
  orderId: string;
  supplierOrderId?: string;
  supplierKey?: string;
};

export type TrackingSyncReadiness = {
  ready: boolean;
  blockingReasons: string[];
  orderId: string;
  marketplace: string | null;
  marketplaceOrderId: string | null;
  orderStatus: string | null;
  supplierOrderId: string | null;
  supplierKey: string | null;
  purchaseStatus: string | null;
  trackingStatus: string | null;
  missingFields: string[];
};

export type TrackingSyncPayload = {
  marketplace: "ebay";
  orderId: string;
  marketplaceOrderId: string;
  supplierOrderId: string;
  supplierKey: string;
  buyerCountry: string | null;
  totalPrice: string | null;
  currency: string;
  orderStatus: string;
  purchaseStatus: string;
  tracking: {
    trackingNumber: string;
    trackingCarrier: string;
    trackingStatus: string;
    trackingRecordedAt: string | null;
  };
  items: Array<{
    orderItemId: string;
    listingId: string | null;
    listingExternalId: string | null;
    supplierKey: string | null;
    supplierProductId: string | null;
    quantity: number;
    itemPrice: string;
  }>;
};

const READY_ORDER_STATUSES = new Set<OrderStatus>([
  "PURCHASE_PLACED",
  "TRACKING_PENDING",
  "TRACKING_RECEIVED",
]);

const READY_PURCHASE_STATUSES = new Set(["SUBMITTED", "CONFIRMED"]);

async function getOrderBase(orderId: string) {
  const rows = await db
    .select({
      id: orders.id,
      marketplace: orders.marketplace,
      marketplaceOrderId: orders.marketplaceOrderId,
      buyerCountry: orders.buyerCountry,
      totalPrice: orders.totalPrice,
      currency: orders.currency,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  return rows[0] ?? null;
}

export async function getLatestTrackableSupplierAttempt(
  input: TrackingSyncAttemptSelector
): Promise<SupplierOrderRow | null> {
  if (input.supplierOrderId) {
    const exact = await db
      .select()
      .from(supplierOrders)
      .where(
        and(
          eq(supplierOrders.id, input.supplierOrderId),
          eq(supplierOrders.orderId, input.orderId)
        )
      )
      .limit(1);
    return exact[0] ?? null;
  }

  const predicates = [
    eq(supplierOrders.orderId, input.orderId),
    inArray(supplierOrders.purchaseStatus, ["SUBMITTED", "CONFIRMED"]),
    sql`COALESCE(NULLIF(BTRIM(${supplierOrders.trackingNumber}), ''), NULL) IS NOT NULL`,
  ];

  if (input.supplierKey) {
    predicates.push(eq(supplierOrders.supplierKey, input.supplierKey));
  }

  const rows = await db
    .select()
    .from(supplierOrders)
    .where(and(...predicates))
    .orderBy(desc(supplierOrders.attemptNo), desc(supplierOrders.updatedAt), desc(supplierOrders.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

export async function getTrackingSyncReadiness(
  input: TrackingSyncAttemptSelector
): Promise<TrackingSyncReadiness> {
  const blockingReasons: string[] = [];
  const missingFields: string[] = [];

  const order = await getOrderBase(input.orderId);
  if (!order) {
    return {
      ready: false,
      blockingReasons: [`Order not found: ${input.orderId}`],
      orderId: input.orderId,
      marketplace: null,
      marketplaceOrderId: null,
      orderStatus: null,
      supplierOrderId: null,
      supplierKey: null,
      purchaseStatus: null,
      trackingStatus: null,
      missingFields: ["order"],
    };
  }

  const marketplace = (order.marketplace ?? "").toLowerCase();
  if (marketplace !== "ebay") {
    blockingReasons.push(
      `Tracking sync preparation is eBay-only. Found marketplace=${order.marketplace}`
    );
  }

  if (!order.marketplaceOrderId || !order.marketplaceOrderId.trim()) {
    missingFields.push("marketplace_order_id");
    blockingReasons.push("Missing marketplace_order_id on order.");
  }

  if (!READY_ORDER_STATUSES.has(order.status as OrderStatus)) {
    blockingReasons.push(
      `Order status ${order.status} is not eligible for tracking sync preparation.`
    );
  }

  const attempt = await getLatestTrackableSupplierAttempt(input);
  if (!attempt) {
    missingFields.push("supplier_order_attempt");
    blockingReasons.push("No eligible supplier purchase attempt with tracking found.");
  } else {
    if (!READY_PURCHASE_STATUSES.has(attempt.purchaseStatus)) {
      blockingReasons.push(
        `Supplier purchase status ${attempt.purchaseStatus} is not eligible for tracking sync.`
      );
    }

    if (!attempt.trackingNumber || !attempt.trackingNumber.trim()) {
      missingFields.push("tracking_number");
      blockingReasons.push("Missing tracking_number in supplier attempt.");
    }

    if (!attempt.trackingCarrier || !attempt.trackingCarrier.trim()) {
      missingFields.push("tracking_carrier");
      blockingReasons.push("Missing tracking_carrier in supplier attempt.");
    }
  }

  return {
    ready: blockingReasons.length === 0,
    blockingReasons,
    orderId: order.id,
    marketplace: order.marketplace,
    marketplaceOrderId: order.marketplaceOrderId,
    orderStatus: order.status,
    supplierOrderId: attempt?.id ?? null,
    supplierKey: attempt?.supplierKey ?? null,
    purchaseStatus: attempt?.purchaseStatus ?? null,
    trackingStatus: attempt?.trackingStatus ?? null,
    missingFields,
  };
}

export async function prepareTrackingSyncPayload(
  input: TrackingSyncAttemptSelector
): Promise<TrackingSyncPayload> {
  const readiness = await getTrackingSyncReadiness(input);
  if (!readiness.ready || !readiness.supplierOrderId || !readiness.marketplaceOrderId) {
    const reasonText = readiness.blockingReasons.join(" | ");
    throw new Error(
      `Tracking sync payload cannot be prepared for order ${input.orderId}: ${reasonText}`
    );
  }

  const [order] = await db
    .select({
      id: orders.id,
      marketplaceOrderId: orders.marketplaceOrderId,
      buyerCountry: orders.buyerCountry,
      totalPrice: orders.totalPrice,
      currency: orders.currency,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);

  if (!order) {
    throw new Error(`Order not found while preparing tracking payload: ${input.orderId}`);
  }

  const [attempt] = await db
    .select()
    .from(supplierOrders)
    .where(eq(supplierOrders.id, readiness.supplierOrderId))
    .limit(1);

  if (!attempt) {
    throw new Error(`Supplier attempt not found: ${readiness.supplierOrderId}`);
  }

  const itemRows = await db
    .select({
      orderItemId: orderItems.id,
      listingId: orderItems.listingId,
      listingExternalId: listings.publishedExternalId,
      supplierKey: orderItems.supplierKey,
      supplierProductId: orderItems.supplierProductId,
      quantity: orderItems.quantity,
      itemPrice: orderItems.itemPrice,
    })
    .from(orderItems)
    .leftJoin(listings, eq(orderItems.listingId, listings.id))
    .where(eq(orderItems.orderId, input.orderId));

  return {
    marketplace: "ebay",
    orderId: order.id,
    marketplaceOrderId: order.marketplaceOrderId,
    supplierOrderId: attempt.id,
    supplierKey: attempt.supplierKey,
    buyerCountry: order.buyerCountry,
    totalPrice: order.totalPrice == null ? null : String(order.totalPrice),
    currency: order.currency,
    orderStatus: order.status,
    purchaseStatus: attempt.purchaseStatus,
    tracking: {
      trackingNumber: attempt.trackingNumber ?? "",
      trackingCarrier: attempt.trackingCarrier ?? "",
      trackingStatus: attempt.trackingStatus,
      trackingRecordedAt: attempt.trackingRecordedAt?.toISOString() ?? null,
    },
    items: itemRows.map((row) => ({
      orderItemId: row.orderItemId,
      listingId: row.listingId,
      listingExternalId: row.listingExternalId,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      quantity: row.quantity,
      itemPrice: String(row.itemPrice),
    })),
  };
}

export type OrderTrackingConsoleRow = {
  orderId: string;
  ebayOrderId: string;
  buyerCountry: string | null;
  total: string | null;
  status: string;
  listingId: string | null;
  listingExternalId: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  purchaseStatus: string | null;
  trackingStatus: string | null;
  trackingCarrier: string | null;
};

export async function getOrderTrackingConsoleRows(limit = 100): Promise<OrderTrackingConsoleRow[]> {
  const rows = await db.execute<OrderTrackingConsoleRow>(sql`
    SELECT
      o.id AS "orderId",
      o.marketplace_order_id AS "ebayOrderId",
      o.buyer_country AS "buyerCountry",
      CASE WHEN o.total_price IS NULL THEN NULL ELSE o.total_price::text END AS "total",
      o.status AS "status",
      item.listing_id AS "listingId",
      l.published_external_id AS "listingExternalId",
      item.supplier_key AS "supplierKey",
      item.supplier_product_id AS "supplierProductId",
      so.purchase_status AS "purchaseStatus",
      so.tracking_status AS "trackingStatus",
      so.tracking_carrier AS "trackingCarrier"
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT oi.listing_id, oi.supplier_key, oi.supplier_product_id
      FROM order_items oi
      WHERE oi.order_id = o.id
      ORDER BY oi.created_at ASC
      LIMIT 1
    ) item ON TRUE
    LEFT JOIN listings l ON l.id = item.listing_id
    LEFT JOIN LATERAL (
      SELECT so2.purchase_status, so2.tracking_status, so2.tracking_carrier
      FROM supplier_orders so2
      WHERE so2.order_id = o.id
      ORDER BY so2.attempt_no DESC, so2.updated_at DESC, so2.created_at DESC
      LIMIT 1
    ) so ON TRUE
    WHERE LOWER(o.marketplace) = 'ebay'
    ORDER BY o.updated_at DESC NULLS LAST
    LIMIT ${Math.max(1, Math.min(limit, 500))}
  `);

  return rows.rows ?? [];
}
