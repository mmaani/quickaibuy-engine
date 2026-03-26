import { pollCjTrackingAndSync } from "@/lib/suppliers/cjTracking";

export async function runTrackingSyncWorker(input?: {
  orderId?: string;
  limit?: number;
  actorId?: string;
}) {
  return pollCjTrackingAndSync({
    orderId: input?.orderId,
    limit: input?.limit,
    actorId: input?.actorId ?? "trackingSync.worker",
  });
}

export default runTrackingSyncWorker;
