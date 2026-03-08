import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const result = await client.query(`
    UPDATE profitable_candidates
    SET
      approved_ts = COALESCE(approved_ts, NOW()),
      approved_by = COALESCE(approved_by, 'legacy-approval-backfill'),
      listing_eligible = TRUE,
      listing_eligible_ts = COALESCE(listing_eligible_ts, NOW()),
      listing_block_reason = NULL
    WHERE decision_status = 'APPROVED'
      AND marketplace_key = 'ebay'
    RETURNING id, supplier_key, supplier_product_id, marketplace_key
  `);

  console.log("Backfilled approved eBay candidates:");
  console.table(result.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
