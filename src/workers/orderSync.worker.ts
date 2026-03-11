import { syncEbayOrders } from "@/lib/orders/syncEbayOrders";

export async function runOrderSyncWorker(input?: {
  limit?: number;
  lookbackHours?: number;
  actorId?: string;
}) {
  const result = await syncEbayOrders({
    limit: input?.limit,
    lookbackHours: input?.lookbackHours,
    actorId: input?.actorId ?? "orderSync.worker",
  });

  return {
    ...result,
  };
}

export default runOrderSyncWorker;
