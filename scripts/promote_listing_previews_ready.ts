import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";
import { markListingReadyToPublish } from "../src/lib/listings/markListingReadyToPublish";

const { Client } = pg;

async function main() {
  const limit = Number(process.argv[2] || "10");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const result = await client.query(`
    SELECT
      l.id,
      l.candidate_id,
      l.marketplace_key,
      l.status,
      pc.decision_status,
      pc.listing_eligible
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.marketplace_key = 'ebay'
      AND l.status = 'PREVIEW'
      AND pc.decision_status = 'APPROVED'
      AND pc.listing_eligible = TRUE
    ORDER BY l.updated_at ASC, l.created_at ASC
    LIMIT $1
  `, [limit]);

  console.log("Eligible PREVIEW rows found:");
  console.table(result.rows);

  const outcomes = [];
  for (const row of result.rows) {
    const outcome = await markListingReadyToPublish({
      listingId: row.id,
      actorId: "promote_listing_previews_ready",
      actorType: "SYSTEM",
    });
    outcomes.push(outcome);
  }

  console.log("\nPromotion results:");
  console.table(outcomes);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
