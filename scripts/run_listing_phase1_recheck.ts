import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { recomputeListingPhase1Diagnostics } from "@/lib/listings/listingPhase1Diagnostics";

async function main() {
  const listingId = String(process.argv[2] ?? "").trim();
  const limit = Math.max(1, Number(process.argv[3] ?? 50));

  const ids = listingId
    ? [listingId]
    : (
        await db.execute<{ id: string }>(sql`
          SELECT id
          FROM listings
          WHERE lower(coalesce(marketplace_key, '')) = 'ebay'
          ORDER BY updated_at DESC NULLS LAST
          LIMIT ${limit}
        `)
      ).rows.map((row) => String(row.id));

  if (!ids.length) {
    console.log("[phase1-recheck] no listings found");
    return;
  }

  let okCount = 0;
  let failCount = 0;
  for (const id of ids) {
    const result = await recomputeListingPhase1Diagnostics({
      listingId: id,
      actorId: "scripts.run_listing_phase1_recheck",
      actorType: "SYSTEM",
    });
    if (result.ok) okCount += 1;
    else failCount += 1;
  }

  console.log("[phase1-recheck] completed", {
    requested: ids.length,
    okCount,
    failCount,
  });
}

main().catch((error) => {
  console.error("[phase1-recheck] failed", error);
  process.exitCode = 1;
});
