import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { db } = await import("../src/lib/db");
  const { profitableCandidates } = await import("../src/lib/db/schema");
  const { eq, desc } = await import("drizzle-orm");
  const { Queue } = await import("bullmq");
  const { bullConnection } = await import("../src/lib/bull");
  const { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } = await import("../src/lib/jobNames");

  const limit = Number(process.argv[2] || "10");
  const marketplace = (process.argv[3] || "ebay").toLowerCase();

  const rows = await db
    .select({
      supplierKey: profitableCandidates.supplierKey,
      supplierProductId: profitableCandidates.supplierProductId,
      marketplaceKey: profitableCandidates.marketplaceKey,
      marketplaceListingId: profitableCandidates.marketplaceListingId,
      decisionStatus: profitableCandidates.decisionStatus,
      calcTs: profitableCandidates.calcTs,
    })
    .from(profitableCandidates)
    .where(eq(profitableCandidates.decisionStatus, "APPROVED"))
    .orderBy(desc(profitableCandidates.calcTs))
    .limit(limit);

  const filtered = rows.filter(
    (r) => String(r.marketplaceKey).toLowerCase() === marketplace
  );

  const queue = new Queue(JOBS_QUEUE_NAME, { connection: bullConnection, prefix: BULL_PREFIX });

  const enqueued = [];

  for (const row of filtered) {
    const job = await queue.add(
      JOB_NAMES.LISTING_PREPARE,
      {
        limit: 1,
        marketplace: row.marketplaceKey,
        forceRefresh: false,
        supplierKey: row.supplierKey,
        supplierProductId: row.supplierProductId,
        marketplaceKey: row.marketplaceKey,
        marketplaceListingId: row.marketplaceListingId,
      },
      {
        jobId: [
          "listing-prepare-approved",
          row.supplierKey,
          row.supplierProductId,
          row.marketplaceKey,
          row.marketplaceListingId,
        ].join("-"),
        removeOnComplete: 1000,
        removeOnFail: 5000,
      }
    );

    enqueued.push({
      jobId: job.id,
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      marketplaceKey: row.marketplaceKey,
      marketplaceListingId: row.marketplaceListingId,
      decisionStatus: row.decisionStatus,
    });
  }

  await queue.close();

  console.log(
    JSON.stringify(
      {
        ok: true,
        approvedFound: rows.length,
        marketplaceFiltered: filtered.length,
        enqueued: enqueued.length,
        rows: enqueued,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
