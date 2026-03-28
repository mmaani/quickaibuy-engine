import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function run() {
  const [missingLinkage, unlockedLinkage, staleOrUnknownStock, blockedByStock, blockedByFallback, changedAfterApproval] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS count FROM listings WHERE COALESCE(NULLIF(BTRIM(supplier_key), ''), '') = '' OR COALESCE(NULLIF(BTRIM(supplier_product_id), ''), '') = ''`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM listings WHERE supplier_link_locked = FALSE`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM listings WHERE supplier_stock_status IN ('OUT_OF_STOCK', 'UNKNOWN') OR stock_verified_at IS NULL OR stock_verified_at < NOW() - INTERVAL '30 minutes'`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM order_events WHERE event_type = 'MANUAL_NOTE' AND (details ->> 'reason') ILIKE '%OUT_OF_STOCK%' OR (details ->> 'reason') ILIKE '%STOCK_%'`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM order_events WHERE event_type = 'MANUAL_NOTE' AND ((details ->> 'reason') ILIKE '%SUPPLIER_FALLBACK_BLOCKED%' OR (details ->> 'reason') ILIKE '%SUPPLIER_SUBSTITUTION_BLOCKED%' OR (details ->> 'reason') ILIKE '%LINKED_SUPPLIER_PRODUCT_MISMATCH%')`),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM order_events
      WHERE event_type = 'MANUAL_NOTE'
        AND details ->> 'action' = 'MANUAL_SUPPLIER_LINKAGE_REPAIRED'
        AND COALESCE(details ->> 'requiresListingReapproval', 'false') = 'true'
    `),
  ]);

  const output = {
    missingLinkageListings: missingLinkage.rows?.[0]?.count ?? 0,
    unlockedLinkageListings: unlockedLinkage.rows?.[0]?.count ?? 0,
    staleOrUnknownStockListings: staleOrUnknownStock.rows?.[0]?.count ?? 0,
    blockedOrdersStock: blockedByStock.rows?.[0]?.count ?? 0,
    blockedOrdersFallback: blockedByFallback.rows?.[0]?.count ?? 0,
    linkageChangedAfterApproval: changedAfterApproval.rows?.[0]?.count ?? 0,
  };

  console.log(JSON.stringify(output, null, 2));
}

run().catch((error) => {
  console.error("diagnose_supplier_linkage_safety failed", error);
  process.exitCode = 1;
});
