export type InventoryRiskSeverity = "LOW" | "MEDIUM" | "HIGH";

export type InventoryRiskAction = "FLAG" | "MANUAL_REVIEW" | "AUTO_PAUSE";

export type InventoryRiskCode =
  | "PRICE_DRIFT_HIGH"
  | "SUPPLIER_OUT_OF_STOCK"
  | "SNAPSHOT_TOO_OLD"
  | "SUPPLIER_SHIPPING_CHANGED"
  | "LISTING_REMOVED";

export type InventoryRiskSignal = {
  code: InventoryRiskCode;
  severity: InventoryRiskSeverity;
  message: string;
  meta?: Record<string, unknown>;
};

const actionBySeverity: Record<InventoryRiskSeverity, InventoryRiskAction> = {
  LOW: "FLAG",
  MEDIUM: "MANUAL_REVIEW",
  HIGH: "AUTO_PAUSE",
};

const severityRank: Record<InventoryRiskSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

export function resolveInventoryRiskAction(
  signals: InventoryRiskSignal[]
): {
  severity: InventoryRiskSeverity | null;
  action: InventoryRiskAction | null;
} {
  if (signals.length === 0) {
    return { severity: null, action: null };
  }

  const severity = signals.reduce<InventoryRiskSeverity>((current, signal) => {
    return severityRank[signal.severity] > severityRank[current]
      ? signal.severity
      : current;
  }, "LOW");

  return {
    severity,
    action: actionBySeverity[severity],
  };
}
