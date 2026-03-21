import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Pool } = pg;

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL_DIRECT or DATABASE_URL");
  }
  return connectionString;
}

function isSslDisabled() {
  return String(process.env.PGSSLMODE || "").toLowerCase() === "disable";
}

function flattenErrorDetail(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;

  const parts = [];
  const queue = [error];
  const seen = new Set();

  while (queue.length > 0 && parts.length < 20) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (current instanceof Error) {
      if (current.message) parts.push(current.message);
      if (Array.isArray(current.errors)) queue.push(...current.errors);
      if (current.cause) queue.push(current.cause);
      continue;
    }

    if (typeof current === "object") {
      if (typeof current.message === "string" && current.message.trim()) {
        parts.push(current.message);
      }
      if (Array.isArray(current.errors)) queue.push(...current.errors);
      if (current.cause) queue.push(current.cause);
    }
  }

  if (parts.length > 0) {
    return parts.join(" | ");
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function classifyError(error) {
  const detail = flattenErrorDetail(error);
  const message = detail.toLowerCase();

  if (
    message.includes("eai_again") ||
    message.includes("enotfound") ||
    message.includes("dns") ||
    message.includes("name resolution")
  ) {
    return {
      status: "DNS_FAILURE",
      reason: "Hostname lookup failed",
      nextStep: "Verify host DNS resolution and retry in 30-60 seconds.",
      detail,
    };
  }

  if (
    message.includes("enetunreach") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("timeout") ||
    message.includes("unreachable")
  ) {
    return {
      status: "NETWORK_UNREACHABLE",
      reason: "Network endpoint unreachable",
      nextStep: "Check firewall/network routing and endpoint status.",
      detail,
    };
  }

  if (message.includes("missing") || message.includes("invalid") || message.includes("not set")) {
    return {
      status: "CONFIG_MISSING",
      reason: "Required configuration missing or invalid",
      nextStep: "Set required environment values and retry.",
      detail,
    };
  }

  return {
    status: "UNKNOWN",
    reason: "Unclassified runtime failure",
    nextStep: "Inspect the full runtime error and retry.",
    detail,
  };
}

async function main() {
  const pool = new Pool({
    connectionString: getConnectionString(),
    ssl: isSslDisabled() ? false : { rejectUnauthorized: false },
  });

  try {
    const summary = await pool.query(`
      WITH latest_attempts AS (
        SELECT DISTINCT ON (so.order_id)
          so.order_id,
          so.purchase_status,
          so.tracking_status,
          so.tracking_synced_at,
          so.tracking_sync_error
        FROM supplier_orders so
        ORDER BY so.order_id, so.attempt_no DESC, so.updated_at DESC, so.created_at DESC
      ),
      event_counts AS (
        SELECT
          oe.order_id,
          COUNT(*)::int AS total_events,
          COUNT(*) FILTER (WHERE oe.event_type = 'ORDER_SYNCED')::int AS order_synced_events,
          COUNT(*) FILTER (WHERE oe.event_type = 'TRACKING_SYNC_SUCCEEDED')::int AS tracking_sync_succeeded_events,
          COUNT(*) FILTER (WHERE oe.event_type = 'TRACKING_SYNC_FAILED')::int AS tracking_sync_failed_events
        FROM order_events oe
        GROUP BY oe.order_id
      )
      SELECT
        COUNT(*)::int AS orders_total,
        COUNT(*) FILTER (WHERE LOWER(o.marketplace) = 'ebay')::int AS ebay_orders_total,
        COUNT(*) FILTER (WHERE UPPER(o.status) = 'TRACKING_SYNCED')::int AS orders_tracking_synced,
        COUNT(*) FILTER (WHERE UPPER(o.status) = 'MANUAL_REVIEW')::int AS orders_manual_review,
        COUNT(*) FILTER (WHERE UPPER(o.status) = 'READY_FOR_PURCHASE_REVIEW')::int AS orders_ready_for_purchase_review,
        COUNT(*) FILTER (WHERE UPPER(o.status) = 'PURCHASE_APPROVED')::int AS orders_purchase_approved,
        COUNT(*) FILTER (WHERE UPPER(o.status) IN ('PURCHASE_PLACED', 'TRACKING_PENDING'))::int AS orders_waiting_tracking,
        COUNT(*) FILTER (WHERE UPPER(o.status) = 'TRACKING_RECEIVED')::int AS orders_ready_to_sync,
        COUNT(la.order_id)::int AS supplier_attempt_orders,
        COUNT(*) FILTER (WHERE la.purchase_status IN ('SUBMITTED', 'CONFIRMED'))::int AS supplier_purchase_recorded_orders,
        COUNT(*) FILTER (
          WHERE COALESCE(NULLIF(BTRIM(la.tracking_status), ''), 'NOT_AVAILABLE') <> 'NOT_AVAILABLE'
        )::int AS tracking_updates_recorded,
        COUNT(*) FILTER (WHERE la.tracking_synced_at IS NOT NULL)::int AS tracking_updates_synced,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(BTRIM(la.tracking_sync_error), ''), '') <> '')::int AS tracking_sync_errors,
        COALESCE(SUM(ec.total_events), 0)::int AS order_events_total,
        COALESCE(SUM(ec.order_synced_events), 0)::int AS order_synced_events_total,
        COALESCE(SUM(ec.tracking_sync_succeeded_events), 0)::int AS tracking_sync_succeeded_events_total,
        COALESCE(SUM(ec.tracking_sync_failed_events), 0)::int AS tracking_sync_failed_events_total
      FROM orders o
      LEFT JOIN latest_attempts la ON la.order_id = o.id
      LEFT JOIN event_counts ec ON ec.order_id = o.id
    `);

    const recentOrders = await pool.query(`
      WITH latest_attempts AS (
        SELECT DISTINCT ON (so.order_id)
          so.order_id,
          so.supplier_key,
          so.purchase_status,
          so.tracking_number,
          so.tracking_carrier,
          so.tracking_status,
          so.tracking_synced_at,
          so.tracking_sync_error
        FROM supplier_orders so
        ORDER BY so.order_id, so.attempt_no DESC, so.updated_at DESC, so.created_at DESC
      )
      SELECT
        o.id,
        o.marketplace,
        o.marketplace_order_id,
        o.status,
        o.buyer_country,
        o.total_price::text AS total_price,
        o.currency,
        o.created_at::text AS created_at,
        o.updated_at::text AS updated_at,
        la.supplier_key,
        la.purchase_status,
        la.tracking_status,
        la.tracking_carrier,
        la.tracking_synced_at::text AS tracking_synced_at,
        la.tracking_sync_error,
        (
          SELECT COUNT(*)::int
          FROM order_events oe
          WHERE oe.order_id = o.id
        ) AS event_count
      FROM orders o
      LEFT JOIN latest_attempts la ON la.order_id = o.id
      WHERE LOWER(o.marketplace) = 'ebay'
      ORDER BY o.updated_at DESC NULLS LAST
      LIMIT 10
    `);

    console.log(
      JSON.stringify(
        {
          status: "OK",
          checkedAt: new Date().toISOString(),
          summary: summary.rows[0] ?? null,
          recentOrders: recentOrders.rows ?? [],
        },
        null,
        2
      )
    );
  } catch (error) {
    const c = classifyError(error);
    console.log(
      JSON.stringify(
        {
          status: "FAILED",
          class: c.status,
          reason: c.reason,
          nextStep: c.nextStep,
          detail: c.detail,
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

main();
