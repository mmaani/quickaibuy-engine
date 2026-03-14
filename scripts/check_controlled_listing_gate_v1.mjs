import pg from "pg";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();
const { Client } = pg;

const client = new Client({ connectionString: getRequiredDatabaseUrl() });

async function main() {
  await client.connect();

  const cols = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_name IN ('profitable_candidates', 'listings', 'listing_daily_caps')
    ORDER BY table_name, ordinal_position
  `);

  console.log("Columns:");
  console.table(cols.rows);

  const caps = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name = 'listing_daily_caps'
  `);

  console.log("listing_daily_caps exists:", caps.rows.length === 1);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
