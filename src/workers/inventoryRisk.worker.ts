import { runInventoryRiskMonitor } from "@/lib/risk/inventoryRiskMonitor";

export async function runInventoryRiskWorker(input?: {
  limit?: number;
  marketplaceKey?: "ebay";
  actorId?: string;
}) {
  const result = await runInventoryRiskMonitor({
    limit: input?.limit,
    marketplaceKey: (input?.marketplaceKey ?? "ebay") as "ebay",
    actorId: input?.actorId ?? "inventoryRisk.worker",
  });

  console.log("[inventory-risk.worker] completed", result);
  return result;
}

export default runInventoryRiskWorker;
