import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getScaleRolloutCaps } from "@/lib/control/scaleRolloutConfig";

export type AutoPurchaseRateLimitState = {
  allowed: boolean;
  blockingWindow: "1h" | "1d" | "none";
  counts: {
    attempts1h: number;
    attempts1d: number;
  };
  limits: {
    limit1h: number;
    limit1d: number;
  };
  retryHint: string | null;
};

function toInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildRetryHint(blockingWindow: AutoPurchaseRateLimitState["blockingWindow"]): string | null {
  if (blockingWindow === "1h") return "retry after hourly auto-purchase window cools down";
  if (blockingWindow === "1d") return "retry after daily auto-purchase window resets";
  return null;
}

export async function getAutoPurchaseRateLimitCounts(): Promise<{ attempts1h: number; attempts1d: number }> {
  const rows = await db.execute(sql`
    SELECT
      COALESCE(
        SUM(
          CASE
            WHEN event_ts >= now() - interval '1 hour'
              THEN CASE
                WHEN COALESCE(details->>'attempted', '') ~ '^[0-9]+$'
                  THEN (details->>'attempted')::int
                ELSE 0
              END
            ELSE 0
          END
        ),
        0
      )::int AS attempts_1h,
      COALESCE(
        SUM(
          CASE
            WHEN event_ts >= now() - interval '1 day'
              THEN CASE
                WHEN COALESCE(details->>'attempted', '') ~ '^[0-9]+$'
                  THEN (details->>'attempted')::int
                ELSE 0
              END
            ELSE 0
          END
        ),
        0
      )::int AS attempts_1d
    FROM audit_log
    WHERE event_type = 'AUTO_PURCHASE_JOB_COMPLETED'
  `);

  const row = (rows.rows?.[0] ?? {}) as Record<string, unknown>;
  return {
    attempts1h: toInt(row.attempts_1h),
    attempts1d: toInt(row.attempts_1d),
  };
}

export async function getAutoPurchaseRateLimitState(): Promise<AutoPurchaseRateLimitState> {
  const caps = getScaleRolloutCaps();
  const limits = {
    limit1h: caps.autoPurchaseAttempts1h,
    limit1d: caps.autoPurchaseAttempts1d,
  };
  const counts = await getAutoPurchaseRateLimitCounts();

  let blockingWindow: AutoPurchaseRateLimitState["blockingWindow"] = "none";
  if (counts.attempts1h >= limits.limit1h) {
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
