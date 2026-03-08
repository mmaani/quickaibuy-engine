import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  const candidates = await client.query(`
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
      AND l.status = 'READY_TO_PUBLISH'
    ORDER BY l.updated_at ASC, l.created_at ASC
  `);

  const caps = await client.query(`
    SELECT marketplace_key, cap_date, cap_limit, cap_used
    FROM listing_daily_caps
    ORDER BY cap_date DESC, marketplace_key ASC
  `);

  console.log("\nREADY_TO_PUBLISH execution candidates:");
  console.table(candidates.rows);

  console.log("\nlisting_daily_caps:");
  console.table(caps.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
