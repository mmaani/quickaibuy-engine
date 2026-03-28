type WindowThreshold = {
  warnRatePct: number;
  minVolume: number;
};

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
}

function toNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized >= 0 ? normalized : fallback;
}

function toRatio(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

export function getScaleRolloutCaps() {
  return {
    preparePerRun: toPositiveInt(process.env.LISTING_PREPARE_LIMIT_PER_RUN, 20),
    promotePerRun: toPositiveInt(process.env.LISTING_PROMOTE_LIMIT_PER_RUN, 10),
    autoPurchaseLimitPerRun: toPositiveInt(process.env.AUTO_PURCHASE_LIMIT_PER_RUN, 5),
    autoPurchaseAttempts1h: toPositiveInt(process.env.AUTO_PURCHASE_RATE_LIMIT_1H, 5),
    autoPurchaseAttempts1d: toPositiveInt(process.env.AUTO_PURCHASE_RATE_LIMIT_1D, 10),
    supplierFetchFailureSpikeThreshold24h: toPositiveInt(process.env.ALERT_SUPPLIER_FETCH_FAILURE_SPIKE_24H, 15),
    listingPauseSpikeThreshold24h: toPositiveInt(process.env.ALERT_LISTING_PAUSE_SPIKE_24H, 10),
    upstreamFallbackBlockRateWarn: toRatio(process.env.ALERT_SUPPLIER_FALLBACK_BLOCK_RATE_WARN, 0.4),
  };
}

export function getScaleRolloutAlertThresholds(): {
  publishFailureRate: WindowThreshold;
  stockBlockRate: WindowThreshold;
  profitBlockRate: WindowThreshold;
} {
  return {
    publishFailureRate: {
      warnRatePct: toNonNegativeInt(process.env.ALERT_PUBLISH_FAILURE_RATE_WARN_PCT, 20),
      minVolume: toPositiveInt(process.env.ALERT_PUBLISH_FAILURE_MIN_VOLUME, 5),
    },
    stockBlockRate: {
      warnRatePct: toNonNegativeInt(process.env.ALERT_STOCK_BLOCK_RATE_WARN_PCT, 30),
      minVolume: toPositiveInt(process.env.ALERT_STOCK_BLOCK_MIN_VOLUME, 5),
    },
    profitBlockRate: {
      warnRatePct: toNonNegativeInt(process.env.ALERT_PROFIT_BLOCK_RATE_WARN_PCT, 35),
      minVolume: toPositiveInt(process.env.ALERT_PROFIT_BLOCK_MIN_VOLUME, 8),
    },
  };
}
