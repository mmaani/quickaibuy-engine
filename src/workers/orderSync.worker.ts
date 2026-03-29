import { syncEbayOrders } from "@/lib/orders/syncEbayOrders";
import { getManualOverrideSnapshot } from "@/lib/control/manualOverrides";

export async function runOrderSyncWorker(input?: {
  limit?: number;
  lookbackHours?: number;
  actorId?: string;
}) {
  const overrides = await getManualOverrideSnapshot();
  if (!overrides.available || overrides.entries.PAUSE_ORDER_SYNC.enabled || overrides.entries.EMERGENCY_READ_ONLY.enabled) {
    return {
      ok: true,
      fetched: 0,
      normalized: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      skipped: true,
      reason: !overrides.available
        ? "MANUAL_OVERRIDE_STORE_UNAVAILABLE"
        : overrides.entries.EMERGENCY_READ_ONLY.enabled
          ? "EMERGENCY_READ_ONLY"
          : "PAUSE_ORDER_SYNC",
    };
  }

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
