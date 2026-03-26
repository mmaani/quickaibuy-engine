import { runAutoPurchase } from "@/lib/orders/autoPurchase";

export async function runAutoPurchaseWorker(input?: {
  orderId?: string;
  limit?: number;
  actorId?: string;
}) {
  return runAutoPurchase({
    orderId: input?.orderId,
    limit: input?.limit,
    actorId: input?.actorId ?? "autoPurchase.worker",
  });
}

export default runAutoPurchaseWorker;
