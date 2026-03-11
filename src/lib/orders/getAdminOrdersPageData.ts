import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getTrackingSyncReadiness } from "./trackingSync";
import { getTrackingSyncAttemptState } from "./syncTrackingToEbay";

export type AdminOrdersFilter =
  | "all"
  | "needs-review"
  | "waiting-purchase"
  | "waiting-tracking"
  | "ready-sync"
  | "synced"
  | "needs-attention";

export type AdminOrderRow = {
  orderId: string;
  ebayOrderId: string;
  buyerCountry: string | null;
  totalDisplay: string | null;
  status: string;
  listingDisplay: string | null;
  supplierDisplay: string | null;
  supplierProductId: string | null;
  purchaseStatus: string | null;
  trackingStatus: string | null;
  trackingReady: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminOrderItem = {
  id: string;
  listingId: string | null;
  listingExternalId: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  quantity: number;
  itemPrice: string;
  estimatedSupplierCost: string | null;
  estimatedProfit: string | null;
};

export type AdminSupplierAttempt = {
  id: string;
  supplierKey: string;
  attemptNo: number;
  supplierOrderRef: string | null;
  purchaseStatus: string;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  trackingStatus: string;
  manualNote: string | null;
  purchaseRecordedAt: string | null;
  trackingRecordedAt: string | null;
  trackingSyncLastAttemptAt: string | null;
  trackingSyncedAt: string | null;
  trackingSyncError: string | null;
  updatedAt: string | null;
};

export type AdminOrderDetail = {
  order: {
    id: string;
    marketplace: string;
    marketplaceOrderId: string;
    buyerName: string | null;
    buyerCountry: string | null;
    totalPrice: string | null;
    currency: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  items: AdminOrderItem[];
  attempts: AdminSupplierAttempt[];
  latestAttempt: AdminSupplierAttempt | null;
  readiness: Awaited<ReturnType<typeof getTrackingSyncReadiness>>;
  lastSyncState: Awaited<ReturnType<typeof getTrackingSyncAttemptState>> | null;
  events: AdminOrderEvent[];
};

export type AdminOrderEvent = {
  id: string;
  eventType: string;
  eventTs: string | null;
  details: unknown;
};

function isFilter(value: string | null | undefined): value is AdminOrdersFilter {
  return (
    value === "all" ||
    value === "needs-review" ||
    value === "waiting-purchase" ||
    value === "waiting-tracking" ||
    value === "ready-sync" ||
    value === "synced" ||
    value === "needs-attention"
  );
}

export function normalizeAdminOrdersFilter(value: string | null | undefined): AdminOrdersFilter {
  return isFilter(value) ? value : "all";
}

function whereClauseForFilter(filter: AdminOrdersFilter): string {
  switch (filter) {
    case "needs-review":
      return `
        upper(coalesce(o.status, '')) in ('MANUAL_REVIEW', 'NEW', 'NEW_ORDER', 'READY_FOR_PURCHASE_REVIEW')
      `;
    case "waiting-purchase":
      return `
        upper(coalesce(o.status, '')) in ('PURCHASE_APPROVED', 'PURCHASE_PENDING')
      `;
    case "waiting-tracking":
      return `
        upper(coalesce(o.status, '')) in ('PURCHASE_PLACED', 'TRACKING_PENDING')
      `;
    case "ready-sync":
      return `
        upper(coalesce(o.status, '')) = 'TRACKING_RECEIVED'
      `;
    case "synced":
      return `
        upper(coalesce(o.status, '')) = 'TRACKING_SYNCED'
      `;
    case "needs-attention":
      return `
        upper(coalesce(o.status, '')) in ('FAILED', 'CANCELED')
        or coalesce(so.tracking_sync_error, '') <> ''
        or upper(coalesce(so.purchase_status, '')) = 'FAILED'
      `;
    case "all":
    default:
      return "1=1";
  }
}

export async function getAdminOrdersRows(input?: {
  filter?: AdminOrdersFilter;
  limit?: number;
}): Promise<AdminOrderRow[]> {
  const filter = input?.filter ?? "all";
  const limit = Math.max(1, Math.min(Number(input?.limit ?? 150), 500));
  const whereClause = whereClauseForFilter(filter);

  const rows = await db.execute<AdminOrderRow>(sql.raw(`
    SELECT
      o.id AS "orderId",
      o.marketplace_order_id AS "ebayOrderId",
      o.buyer_country AS "buyerCountry",
      CASE
        WHEN o.total_price IS NULL THEN NULL
        ELSE (o.total_price::text || ' ' || coalesce(o.currency, 'USD'))
      END AS "totalDisplay",
      o.status AS "status",
      COALESCE(item.listing_external_id, item.listing_id) AS "listingDisplay",
      item.supplier_key AS "supplierDisplay",
      item.supplier_product_id AS "supplierProductId",
      so.purchase_status AS "purchaseStatus",
      so.tracking_status AS "trackingStatus",
      (
        upper(coalesce(o.status, '')) = 'TRACKING_RECEIVED'
        AND upper(coalesce(so.purchase_status, '')) IN ('SUBMITTED', 'CONFIRMED')
        AND coalesce(nullif(btrim(so.tracking_number), ''), '') <> ''
        AND coalesce(nullif(btrim(so.tracking_carrier), ''), '') <> ''
      ) AS "trackingReady",
      o.created_at::text AS "createdAt",
      o.updated_at::text AS "updatedAt"
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT
        oi.listing_id::text AS listing_id,
        l.published_external_id AS listing_external_id,
        oi.supplier_key,
        oi.supplier_product_id
      FROM order_items oi
      LEFT JOIN listings l ON l.id = oi.listing_id
      WHERE oi.order_id = o.id
      ORDER BY oi.created_at ASC
      LIMIT 1
    ) item ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        so2.purchase_status,
        so2.tracking_status,
        so2.tracking_number,
        so2.tracking_carrier,
        so2.tracking_sync_error
      FROM supplier_orders so2
      WHERE so2.order_id = o.id
      ORDER BY so2.attempt_no DESC, so2.updated_at DESC, so2.created_at DESC
      LIMIT 1
    ) so ON TRUE
    WHERE lower(coalesce(o.marketplace, '')) = 'ebay'
      AND (${whereClause})
    ORDER BY o.updated_at DESC NULLS LAST
    LIMIT ${limit}
  `));

  return rows.rows ?? [];
}

export async function getAdminOrderDetail(orderId: string): Promise<AdminOrderDetail | null> {
  const baseRows = await db.execute<AdminOrderDetail["order"]>(sql`
    SELECT
      o.id AS id,
      o.marketplace AS marketplace,
      o.marketplace_order_id AS "marketplaceOrderId",
      o.buyer_name AS "buyerName",
      o.buyer_country AS "buyerCountry",
      CASE WHEN o.total_price IS NULL THEN NULL ELSE o.total_price::text END AS "totalPrice",
      o.currency AS currency,
      o.status AS status,
      o.created_at::text AS "createdAt",
      o.updated_at::text AS "updatedAt"
    FROM orders o
    WHERE o.id = ${orderId}
    LIMIT 1
  `);
  const order = baseRows.rows?.[0] ?? null;
  if (!order) return null;

  const [itemsRows, attemptsRows, readiness, eventsRows] = await Promise.all([
    db.execute<AdminOrderItem>(sql`
      SELECT
        oi.id::text AS id,
        oi.listing_id::text AS "listingId",
        l.published_external_id AS "listingExternalId",
        oi.supplier_key AS "supplierKey",
        oi.supplier_product_id AS "supplierProductId",
        oi.quantity AS quantity,
        oi.item_price::text AS "itemPrice",
        pc.estimated_cogs::text AS "estimatedSupplierCost",
        pc.estimated_profit::text AS "estimatedProfit"
      FROM order_items oi
      LEFT JOIN listings l ON l.id = oi.listing_id
      LEFT JOIN profitable_candidates pc ON pc.id = l.candidate_id
      WHERE oi.order_id = ${orderId}
      ORDER BY oi.created_at ASC
    `),
    db.execute<AdminSupplierAttempt>(sql`
      SELECT
        so.id::text AS id,
        so.supplier_key AS "supplierKey",
        so.attempt_no::int AS "attemptNo",
        so.supplier_order_ref AS "supplierOrderRef",
        so.purchase_status AS "purchaseStatus",
        so.tracking_number AS "trackingNumber",
        so.tracking_carrier AS "trackingCarrier",
        so.tracking_status AS "trackingStatus",
        so.manual_note AS "manualNote",
        so.purchase_recorded_at::text AS "purchaseRecordedAt",
        so.tracking_recorded_at::text AS "trackingRecordedAt",
        so.tracking_sync_last_attempt_at::text AS "trackingSyncLastAttemptAt",
        so.tracking_synced_at::text AS "trackingSyncedAt",
        so.tracking_sync_error AS "trackingSyncError",
        so.updated_at::text AS "updatedAt"
      FROM supplier_orders so
      WHERE so.order_id = ${orderId}
      ORDER BY so.attempt_no DESC, so.updated_at DESC, so.created_at DESC
    `),
    getTrackingSyncReadiness({ orderId }),
    db.execute<AdminOrderEvent>(sql`
      SELECT
        oe.id::text AS id,
        oe.event_type AS "eventType",
        oe.event_ts::text AS "eventTs",
        oe.details AS details
      FROM order_events oe
      WHERE oe.order_id = ${orderId}
      ORDER BY oe.event_ts DESC, oe.id DESC
      LIMIT 100
    `),
  ]);

  const attempts = attemptsRows.rows ?? [];
  const latestAttempt = attempts[0] ?? null;
  const lastSyncState =
    latestAttempt == null
      ? null
      : await getTrackingSyncAttemptState({ orderId, supplierOrderId: latestAttempt.id });

  return {
    order,
    items: itemsRows.rows ?? [],
    attempts,
    latestAttempt,
    readiness,
    lastSyncState,
    events: eventsRows.rows ?? [],
  };
}
