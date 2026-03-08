import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { checkDailyListingCap } from "@/lib/listings/checkDailyListingCap";
import { db } from "@/lib/db";
import { listings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function runListingExecution(maxPerDay = 10) {
  const { remaining: capacity } = await checkDailyListingCap({ dailyCap: maxPerDay });

  if (capacity === 0) {
    console.log("[listing-execute] daily cap reached");
    return {
      ok: true,
      eligible: 0,
      listed: 0,
      skipped: 0,
      dailyRemaining: 0,
    };
  }

  const candidates = await getListingExecutionCandidates({ limit: capacity });

  let listed = 0;
  let skipped = 0;

  console.log("[listing-execute] eligible listings:", candidates.length);

  for (const row of candidates) {
    if (!row?.id) {
      skipped++;
      continue;
    }

    console.log("[listing-execute] listing", {
      listingId: row.id,
      candidateId: row.candidateId,
      marketplaceKey: row.marketplaceKey,
      title: row.title,
      price: row.price,
    });

    await db
      .update(listings)
      .set({
        status: "LISTED",
        updatedAt: new Date(),
      })
      .where(eq(listings.id, row.id));

    listed++;
  }

  const result = {
    ok: true,
    eligible: candidates.length,
    listed,
    skipped,
    dailyRemaining: Math.max(0, capacity - listed),
  };

  console.log("[listing-execute] completed", result);
  return result;
}

export default runListingExecution;
