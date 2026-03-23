import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type DailyListingCapState = {
  ok: boolean;
  marketplaceKey: "ebay";
  dailyCap: number;
  used: number;
  remaining: number;
  allowed: boolean;
};

type DailyCapInput = {
  marketplaceKey?: "ebay";
  dailyCap?: number;
};

function toInt(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolveDailyCap(input?: DailyCapInput): number {
  return toInt(input?.dailyCap ?? process.env.LISTING_DAILY_CAP ?? "10", 10);
}

export async function getDailyListingCap(input?: DailyCapInput): Promise<DailyListingCapState> {
  const marketplaceKey = (input?.marketplaceKey ?? "ebay") as "ebay";
  const dailyCap = resolveDailyCap(input);

  await db.execute(sql`
    INSERT INTO listing_daily_caps (marketplace_key, cap_date, cap_limit, cap_used, created_at, updated_at)
    VALUES (${marketplaceKey}, CURRENT_DATE, ${dailyCap}, 0, NOW(), NOW())
    ON CONFLICT (marketplace_key, cap_date)
    DO UPDATE SET
      cap_limit = EXCLUDED.cap_limit,
      updated_at = NOW()
  `);

  const result = await db.execute(sql`
    SELECT cap_limit, cap_used
    FROM listing_daily_caps
    WHERE marketplace_key = ${marketplaceKey}
      AND cap_date = CURRENT_DATE
    LIMIT 1
  `);

  const row = result.rows[0] ?? {};
  const capLimit = toInt((row as Record<string, unknown>).cap_limit, dailyCap);
  const used = toInt((row as Record<string, unknown>).cap_used, 0);
  const remaining = Math.max(0, capLimit - used);

  return {
    ok: true,
    marketplaceKey,
    dailyCap: capLimit,
    used,
    remaining,
    allowed: remaining > 0,
  };
}

export async function reserveDailyListingSlot(input?: DailyCapInput): Promise<DailyListingCapState> {
  const marketplaceKey = (input?.marketplaceKey ?? "ebay") as "ebay";
  const dailyCap = resolveDailyCap(input);

  await db.execute(sql`
    INSERT INTO listing_daily_caps (marketplace_key, cap_date, cap_limit, cap_used, created_at, updated_at)
    VALUES (${marketplaceKey}, CURRENT_DATE, ${dailyCap}, 0, NOW(), NOW())
    ON CONFLICT (marketplace_key, cap_date)
    DO UPDATE SET
      cap_limit = EXCLUDED.cap_limit,
      updated_at = NOW()
  `);

  const reserved = await db.execute(sql`
    UPDATE listing_daily_caps
    SET
      cap_used = cap_used + 1,
      updated_at = NOW()
    WHERE marketplace_key = ${marketplaceKey}
      AND cap_date = CURRENT_DATE
      AND cap_used < cap_limit
    RETURNING cap_limit, cap_used
  `);

  if (reserved.rows.length > 0) {
    const row = reserved.rows[0] as Record<string, unknown>;
    const capLimit = toInt(row.cap_limit, dailyCap);
    const used = toInt(row.cap_used, 0);

    return {
      ok: true,
      marketplaceKey,
      dailyCap: capLimit,
      used,
      remaining: Math.max(0, capLimit - used),
      allowed: true,
    };
  }

  return getDailyListingCap({ marketplaceKey, dailyCap });
}

export async function releaseDailyListingSlot(input?: DailyCapInput): Promise<DailyListingCapState> {
  const marketplaceKey = (input?.marketplaceKey ?? "ebay") as "ebay";
  const dailyCap = resolveDailyCap(input);

  await db.execute(sql`
    INSERT INTO listing_daily_caps (marketplace_key, cap_date, cap_limit, cap_used, created_at, updated_at)
    VALUES (${marketplaceKey}, CURRENT_DATE, ${dailyCap}, 0, NOW(), NOW())
    ON CONFLICT (marketplace_key, cap_date)
    DO UPDATE SET
      cap_limit = EXCLUDED.cap_limit,
      updated_at = NOW()
  `);

  await db.execute(sql`
    UPDATE listing_daily_caps
    SET
      cap_used = GREATEST(cap_used - 1, 0),
      updated_at = NOW()
    WHERE marketplace_key = ${marketplaceKey}
      AND cap_date = CURRENT_DATE
  `);

  return getDailyListingCap({ marketplaceKey, dailyCap });
}
