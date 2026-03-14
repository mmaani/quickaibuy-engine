import pg from "pg";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();
const { Client } = pg;

const client = new Client({ connectionString: getRequiredDatabaseUrl() });

async function main() {
  await client.connect();

  const rows = await client.query(`
    SELECT
      l.id,
      l.candidate_id,
      l.marketplace_key,
      l.status,
      l.created_at,
      l.updated_at,
      pc.decision_status,
      pc.listing_eligible,
      pc.approved_ts,
      pc.approved_by
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.marketplace_key = 'ebay'
      AND l.status = 'PREVIEW'
    ORDER BY l.updated_at DESC, l.created_at DESC
  `);

  console.log("\nPREVIEW rows that can feed READY_TO_PUBLISH:");
  console.table(rows.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
