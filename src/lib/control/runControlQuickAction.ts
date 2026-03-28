import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { db } from "@/lib/db";
import { enqueueMarketplacePriceScan } from "@/lib/jobs/enqueueMarketplacePriceScan";
import { enqueueProductMatch } from "@/lib/jobs/enqueueProductMatch";
import { enqueueSupplierDiscoverRefresh } from "@/lib/jobs/enqueueSupplierDiscover";
import { enqueueInventoryRiskScan } from "@/lib/jobs/enqueueInventoryRiskScan";
import { enqueueProfitEval } from "@/lib/jobs/enqueueProfitEval";
import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { markListingReadyToPublish } from "@/lib/listings/markListingReadyToPublish";
import { syncEbayOrders } from "@/lib/orders/syncEbayOrders";
import { prepareListingPreviews } from "@/lib/listings/prepareListingPreviews";
import { getScaleRolloutCaps } from "./scaleRolloutConfig";

export async function runControlQuickAction(action: string, actorId: string): Promise<string> {
  let message = "Action completed.";
  const rolloutCaps = getScaleRolloutCaps();

  if (action === "supplier") {
    const job = await enqueueSupplierDiscoverRefresh({
      limitPerKeyword: 10,
      idempotencySuffix: `control-${Date.now()}`,
      reason: "control-action",
    });
    message = `Supplier discover enqueued (${String(job.id)}).`;
  } else if (action === "match") {
    const job = await enqueueProductMatch({
      marketplaceLimit: 25,
    });
    message = `Product match enqueued (${String(job.id)}).`;
  } else if (action === "scan") {
    const job = await enqueueMarketplacePriceScan({ limit: 25, platform: "ebay" });
    message = `Marketplace scan enqueued (${String(job.id)}).`;
  } else if (action === "profit") {
    const job = await enqueueProfitEval({
      limit: 50,
      idempotencySuffix: `control-${Date.now()}`,
      triggerSource: "manual",
    });
    message = `Profit evaluation enqueued (${String(job.id)}).`;
  } else if (action === "order-sync") {
    const result = await syncEbayOrders({
      limit: Number(process.env.ORDER_SYNC_FETCH_LIMIT ?? 50),
      lookbackHours: Number(process.env.ORDER_SYNC_LOOKBACK_HOURS ?? 168),
      actorId: `admin-control:${actorId}`,
    });
    message = `Order sync fetched ${result.fetched}, created ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}, failed ${result.failed}.`;
  } else if (action === "prepare") {
    const result = await prepareListingPreviews({ limit: rolloutCaps.preparePerRun, marketplace: "ebay" });
    message = `Previews created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`;
  } else if (action === "promote") {
    const rows = await db.execute(sql`
      select id
      from listings
      where marketplace_key = 'ebay' and status = 'PREVIEW'
      order by updated_at asc
      limit ${rolloutCaps.promotePerRun}
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
