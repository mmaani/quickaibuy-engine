import { getManualOverrideSnapshot } from "@/lib/control/manualOverrides";

export const CONTROL_QUICK_ACTIONS = [
  { key: "autonomous-refresh", label: "Run autonomous diagnostics + refresh" },
  { key: "autonomous-prepare", label: "Run autonomous prepare cycle" },
  { key: "autonomous-full", label: "Run canonical full cycle" },
  { key: "learning-refresh", label: "Run learning refresh" },
  { key: "order-sync", label: "Run eBay order sync" },
  { key: "inventory-risk-scan", label: "Run inventory risk scan" },
] as const;

export type ControlQuickActionKey = (typeof CONTROL_QUICK_ACTIONS)[number]["key"];

export function getControlQuickActionBlockedReason(
  action: string,
  snapshot: Awaited<ReturnType<typeof getManualOverrideSnapshot>>
): string | null {
  if (!snapshot.available) return "Manual override store unavailable. Actions blocked for safety.";
  if (snapshot.entries.EMERGENCY_READ_ONLY.enabled) return "Emergency read-only mode is active.";
  if (
    snapshot.entries.PAUSE_PUBLISHING.enabled &&
    (action === "autonomous-full" || action === "autonomous-prepare")
  ) {
    return "Publishing is paused.";
  }
  if (
    snapshot.entries.PAUSE_LISTING_PREPARATION.enabled &&
    (action === "autonomous-prepare" || action === "autonomous-full")
  ) {
    return "Listing preparation is paused.";
  }
  if (
    snapshot.entries.PAUSE_MARKETPLACE_SCAN.enabled &&
    (action === "autonomous-refresh" || action === "autonomous-full")
  ) {
    return "Marketplace scan is paused.";
  }
  if (snapshot.entries.PAUSE_ORDER_SYNC.enabled && action === "order-sync") {
    return "Order sync is paused.";
  }
  return null;
}
