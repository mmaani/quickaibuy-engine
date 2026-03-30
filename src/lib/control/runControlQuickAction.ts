import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { enqueueInventoryRiskScan } from "@/lib/jobs/enqueueInventoryRiskScan";
import { enqueueAutonomousOpsBackbone } from "@/lib/jobs/enqueueAutonomousOpsBackbone";
import { enqueueLearningRefreshFromControlPlane, enqueueOrderSyncFromControlPlane } from "@/lib/jobs/enqueueControlJobs";

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
    const job = await enqueueLearningRefreshFromControlPlane(actorId);
    message = `Learning refresh enqueued (${String(job.id)}).`;
  } else if (action === "order-sync") {
    const job = await enqueueOrderSyncFromControlPlane(actorId);
    message = `Order sync enqueued (${String(job.id)}).`;
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
