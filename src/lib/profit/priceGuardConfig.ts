export type PriceGuardThresholds = {
  minProfitUsd: number;
  minMarginPct: number;
  minRoiPct: number;
  reviewProfitBufferUsd: number;
  reviewMarginBufferPct: number;
  reviewRoiBufferPct: number;
  maxSupplierDriftPct: number;
  maxMarketplaceSnapshotAgeHours: number;
  maxSupplierSnapshotAgeHours: number;
  requireShippingData: boolean;
  requireSupplierDriftData: boolean;
};

function toNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

export function getPriceGuardThresholds(): PriceGuardThresholds {
  const maxMarketplaceSnapshotAgeHours = toNumber(
    process.env.PRICE_GUARD_MAX_MARKETPLACE_SNAPSHOT_AGE_HOURS ??
      process.env.PRICE_GUARD_MAX_MARKET_SNAPSHOT_AGE_HOURS,
    24
  );

  return {
    minProfitUsd: toNumber(process.env.PRICE_GUARD_MIN_PROFIT_USD, 1),
    minMarginPct: toNumber(process.env.PRICE_GUARD_MIN_MARGIN_PCT, 20),
    minRoiPct: toNumber(process.env.PRICE_GUARD_MIN_ROI_PCT, 25),
    reviewProfitBufferUsd: toNumber(process.env.PRICE_GUARD_REVIEW_PROFIT_BUFFER_USD, 1),
    reviewMarginBufferPct: toNumber(process.env.PRICE_GUARD_REVIEW_MARGIN_BUFFER_PCT, 3),
    reviewRoiBufferPct: toNumber(process.env.PRICE_GUARD_REVIEW_ROI_BUFFER_PCT, 5),
    // Drift >15% routes to MANUAL_REVIEW unless overridden explicitly.
    maxSupplierDriftPct: toNumber(process.env.PRICE_GUARD_MAX_SUPPLIER_DRIFT_PCT, 15),
    maxMarketplaceSnapshotAgeHours,
    // Supplier snapshots older than 48h are considered stale for publish readiness.
    maxSupplierSnapshotAgeHours: toNumber(
      process.env.PRICE_GUARD_MAX_SUPPLIER_SNAPSHOT_AGE_HOURS,
      48
    ),
    requireShippingData: toBoolean(process.env.PRICE_GUARD_REQUIRE_SHIPPING_DATA, false),
    requireSupplierDriftData: toBoolean(process.env.PRICE_GUARD_REQUIRE_SUPPLIER_DRIFT_DATA, true),
  };
}
