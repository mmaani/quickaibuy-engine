import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function checkDailyListingCap(input?: { dailyCap?: number }) {
  const dailyCap = Number(input?.dailyCap ?? process.env.LISTING_DAILY_CAP ?? "10");

  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM listings
    WHERE status IN ('LISTING_IN_PROGRESS', 'LISTED')
      AND created_at::date = CURRENT_DATE
  `);

  const used = Number(result.rows[0]?.count ?? 0);
  const remaining = Math.max(0, dailyCap - used);

  return {
    ok: true,
    dailyCap,
    used,
    remaining,
    allowed: used < dailyCap,
  };
}
