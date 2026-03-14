import pg from "pg";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: getRequiredDatabaseUrl() });
  await client.connect();

  const rows = await client.query(`
    SELECT id, candidate_id, marketplace_key, status, publish_attempt_count, updated_at
    FROM listings
    WHERE marketplace_key = 'ebay'
      AND status = 'READY_TO_PUBLISH'
    ORDER BY updated_at DESC
    LIMIT 50
  `);

  console.table(rows.rows);
  console.log(`READY_TO_PUBLISH count: ${rows.rows.length}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
