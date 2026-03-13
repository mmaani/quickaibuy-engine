import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { db } from "@/lib/db";
import { handleMarketplaceScanJob } from "@/lib/jobs/marketplaceScan";
import { handleMatchProductsJob } from "@/lib/jobs/matchProducts";
import { runSupplierDiscover } from "@/lib/jobs/supplierDiscover";
import { enqueueInventoryRiskScan } from "@/lib/jobs/enqueueInventoryRiskScan";
import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { markListingReadyToPublish } from "@/lib/listings/markListingReadyToPublish";
import { prepareListingPreviews } from "@/lib/listings/prepareListingPreviews";
import { runProfitEngine } from "@/lib/profit/profitEngine";

export async function runControlQuickAction(action: string, actorId: string): Promise<string> {
  let message = "Action completed.";

  if (action === "supplier") {
    const result = await runSupplierDiscover(10);
    message = `Supplier discover inserted ${result.insertedCount} rows.`;
  } else if (action === "match") {
    const result = await handleMatchProductsJob({ limit: 25 });
    message = `Matching scanned ${result.scanned}; inserted ${result.inserted}, updated ${result.updated} (total upserts ${result.inserted + result.updated}).`;
  } else if (action === "scan") {
    const result = await handleMarketplaceScanJob({ limit: 25, platform: "ebay" });
    message = `Marketplace scan (eBay) scanned ${result.scanned} rows.`;
  } else if (action === "profit") {
    const result = await runProfitEngine({ limit: 50 });
    message = `Profit engine scanned ${result.scanned}; upserted ${result.insertedOrUpdated}; skipped ${result.skipped}; stale deleted ${result.staleDeleted}.`;
  } else if (action === "prepare") {
    const result = await prepareListingPreviews({ limit: 25, marketplace: "ebay" });
    message = `Previews created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`;
  } else if (action === "promote") {
    const rows = await db.execute(sql`
      select id
      from listings
      where marketplace_key = 'ebay' and status = 'PREVIEW'
      order by updated_at asc
      limit 25
    `);

    let promoted = 0;
    let blocked = 0;
    for (const row of (rows.rows ?? []) as Array<{ id: string }>) {
      const out = await markListingReadyToPublish({
        listingId: row.id,
        actorType: "ADMIN",
        actorId,
      });
      if (out.ok) promoted++;
      else blocked++;
    }

    message = `Promoted ${promoted} previews; blocked ${blocked} by review/eligibility safeguards.`;
  } else if (action === "dry-run") {
    const candidates = await getListingExecutionCandidates({ limit: 20, marketplace: "ebay" });
    await writeAuditLog({
      actorType: "ADMIN",
      actorId,
      entityType: "PIPELINE",
      entityId: "listing-execution-diagnostic-snapshot",
      eventType: "LISTING_EXECUTION_DIAGNOSTIC_SNAPSHOT",
      details: { count: candidates.length },
    });
    message = `Listing execution diagnostic snapshot found ${candidates.length} READY_TO_PUBLISH candidates (no worker execution performed).`;
  } else if (action === "monitor") {
    const statusCounts = await db.execute(sql`
      select status, count(*)::int as count
      from listings
      where marketplace_key = 'ebay'
      group by status
      order by count desc
    `);
    await writeAuditLog({
      actorType: "ADMIN",
      actorId,
      entityType: "PIPELINE",
      entityId: "listing-monitor-diagnostic-snapshot",
      eventType: "LISTING_MONITOR_DIAGNOSTIC_SNAPSHOT",
      details: { rows: statusCounts.rows ?? [] },
    });
    message = "Listing monitor diagnostic snapshot recorded (no listing-monitor worker run triggered).";
  } else if (action === "inventory-risk-scan") {
    const job = await enqueueInventoryRiskScan({
      marketplaceKey: "ebay",
      limit: 200,
      idempotencySuffix: `manual-${Date.now()}`,
    });
    message = `Inventory risk scan enqueued (${String(job.id)}).`;
  } else {
    throw new Error(`Unsupported control panel action: ${action}`);
  }

  await writeAuditLog({
    actorType: "ADMIN",
    actorId,
    entityType: "PIPELINE",
    entityId: "admin-control",
    eventType: "CONTROL_PANEL_ACTION_TRIGGERED",
    details: { action, message },
  });

  return message;
}
