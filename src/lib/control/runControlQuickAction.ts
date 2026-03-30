import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { enqueueInventoryRiskScan } from "@/lib/jobs/enqueueInventoryRiskScan";
import { runContinuousLearningRefresh } from "@/lib/learningHub/continuousLearning";
import { syncEbayOrders } from "@/lib/orders/syncEbayOrders";
import { enqueueAutonomousOpsBackbone } from "@/lib/jobs/enqueueAutonomousOpsBackbone";

export async function runControlQuickAction(action: string, actorId: string): Promise<string> {
  let message = "Action completed.";

  if (action === "autonomous-refresh") {
    const job = await enqueueAutonomousOpsBackbone({
      phase: "diagnostics_refresh",
      triggerSource: "control-plane",
      idempotencySuffix: `admin-${Date.now()}`,
    });
    message = `Autonomous diagnostics/refresh enqueued (${String(job.id)}).`;
  } else if (action === "autonomous-prepare") {
    const job = await enqueueAutonomousOpsBackbone({
      phase: "prepare",
      triggerSource: "control-plane",
      idempotencySuffix: `admin-${Date.now()}`,
    });
    message = `Autonomous prepare cycle enqueued (${String(job.id)}).`;
  } else if (action === "autonomous-full") {
    const job = await enqueueAutonomousOpsBackbone({
      phase: "full",
      triggerSource: "control-plane",
      idempotencySuffix: `admin-${Date.now()}`,
    });
    message = `Canonical full cycle enqueued (${String(job.id)}).`;
  } else if (action === "learning-refresh") {
    const result = await runContinuousLearningRefresh({
      trigger: `admin_control:${actorId}`,
      forceFull: true,
    });
    const totalDomains = result.freshness.domains.length;
    const freshDomains =
      totalDomains - result.freshness.staleDomainCount - result.freshness.warningDomainCount;
    message = `Learning refresh completed via pnpm ops:learning-refresh. ok=${result.ok}. freshness=${freshDomains}/${totalDomains} fresh.`;
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
