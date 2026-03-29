import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { enqueueInventoryRiskScan } from "@/lib/jobs/enqueueInventoryRiskScan";
import { syncEbayOrders } from "@/lib/orders/syncEbayOrders";
import { runAutonomousOperations } from "@/lib/autonomousOps/backbone";

export async function runControlQuickAction(action: string, actorId: string): Promise<string> {
  let message = "Action completed.";

  if (action === "autonomous-refresh") {
    const result = await runAutonomousOperations({
      phase: "diagnostics_refresh",
      actorId: `admin-control:${actorId}`,
      actorType: "ADMIN",
    });
    message = `Autonomous diagnostics/refresh completed. ok=${result.ok}. pauses=${result.pauses.length}.`;
  } else if (action === "autonomous-prepare") {
    const result = await runAutonomousOperations({
      phase: "prepare",
      actorId: `admin-control:${actorId}`,
      actorType: "ADMIN",
    });
    message = `Autonomous prepare cycle completed. ok=${result.ok}. ready_to_publish=${result.summary.pipeline.readyToPublish}.`;
  } else if (action === "autonomous-full") {
    const result = await runAutonomousOperations({
      phase: "full",
      actorId: `admin-control:${actorId}`,
      actorType: "ADMIN",
    });
    message = `Autonomous full cycle completed. ok=${result.ok}. pauses=${result.pauses.length}, ready_to_publish=${result.summary.pipeline.readyToPublish}.`;
  } else if (action === "order-sync") {
    const result = await syncEbayOrders({
      limit: Number(process.env.ORDER_SYNC_FETCH_LIMIT ?? 50),
      lookbackHours: Number(process.env.ORDER_SYNC_LOOKBACK_HOURS ?? 168),
      actorId: `admin-control:${actorId}`,
    });
    message = `Order sync fetched ${result.fetched}, created ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}, failed ${result.failed}.`;
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
