import { pollCjTrackingAndSync } from "@/lib/suppliers/cjTracking";
import { getManualOverrideSnapshot } from "@/lib/control/manualOverrides";

export async function runTrackingSyncWorker(input?: {
  orderId?: string;
  limit?: number;
  actorId?: string;
}) {
  const overrides = await getManualOverrideSnapshot();
  if (!overrides.available || overrides.entries.PAUSE_ORDER_SYNC.enabled || overrides.entries.EMERGENCY_READ_ONLY.enabled) {
    return {
      ok: true,
      scanned: 0,
      synced: 0,
      recorded: 0,
      skipped: 0,
      failed: 0,
      orders: [],
      paused: true,
      reason: !overrides.available
        ? "MANUAL_OVERRIDE_STORE_UNAVAILABLE"
        : overrides.entries.EMERGENCY_READ_ONLY.enabled
          ? "EMERGENCY_READ_ONLY"
          : "PAUSE_ORDER_SYNC",
    };
  }

  return pollCjTrackingAndSync({
    orderId: input?.orderId,
    limit: input?.limit,
    actorId: input?.actorId ?? "trackingSync.worker",
  });
}

export default runTrackingSyncWorker;
