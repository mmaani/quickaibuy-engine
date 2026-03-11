import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type PublishRateLimitConfig = {
  limit15m: number;
  limit1h: number;
  limit1d: number;
};

export type PublishRateLimitCounts = {
  attempts15m: number;
  attempts1h: number;
  attempts1d: number;
};

export type PublishRateLimitState = {
  allowed: boolean;
  blockingWindow: "15m" | "1h" | "1d" | "none";
  counts: PublishRateLimitCounts;
  limits: PublishRateLimitConfig;
  retryHint: string | null;
};

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
}

export function getPublishRateLimitConfig(): PublishRateLimitConfig {
  return {
    limit15m: toPositiveInt(process.env.LISTING_RATE_LIMIT_15M, 3),
    limit1h: toPositiveInt(process.env.LISTING_RATE_LIMIT_1H, 8),
    limit1d: toPositiveInt(process.env.LISTING_RATE_LIMIT_1D, 15),
  };
}

function buildRetryHint(blockingWindow: PublishRateLimitState["blockingWindow"]): string | null {
  if (blockingWindow === "15m") return "retry after 15m window cools down";
  if (blockingWindow === "1h") return "retry after hourly window cools down";
  if (blockingWindow === "1d") return "retry after daily window resets";
  return null;
}

export async function getPublishRateLimitCounts(marketplaceKey: "ebay" = "ebay"): Promise<PublishRateLimitCounts> {
  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE event_ts >= NOW() - INTERVAL '15 minutes')::int AS attempts_15m,
      COUNT(*) FILTER (WHERE event_ts >= NOW() - INTERVAL '1 hour')::int AS attempts_1h,
      COUNT(*) FILTER (WHERE event_ts >= NOW() - INTERVAL '1 day')::int AS attempts_1d
    FROM audit_log
    WHERE event_type = 'LISTING_PUBLISH_STARTED'
      AND (
        LOWER(COALESCE(details->>'marketplaceKey', '')) = ${marketplaceKey}
        OR details->>'marketplaceKey' IS NULL
      )
  `);

  const row = (rows.rows?.[0] ?? {}) as Record<string, unknown>;
  const toInt = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    attempts15m: toInt(row.attempts_15m),
    attempts1h: toInt(row.attempts_1h),
    attempts1d: toInt(row.attempts_1d),
  };
}

export async function getPublishRateLimitState(marketplaceKey: "ebay" = "ebay"): Promise<PublishRateLimitState> {
  const limits = getPublishRateLimitConfig();
  const counts = await getPublishRateLimitCounts(marketplaceKey);

  let blockingWindow: PublishRateLimitState["blockingWindow"] = "none";
  if (counts.attempts15m >= limits.limit15m) {
    blockingWindow = "15m";
  } else if (counts.attempts1h >= limits.limit1h) {
    blockingWindow = "1h";
  } else if (counts.attempts1d >= limits.limit1d) {
    blockingWindow = "1d";
  }

  return {
    allowed: blockingWindow === "none",
    blockingWindow,
    counts,
    limits,
    retryHint: buildRetryHint(blockingWindow),
  };
}
