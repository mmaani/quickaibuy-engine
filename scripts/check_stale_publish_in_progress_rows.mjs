import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  const staleMinutes = Number(process.argv[2] || "30");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const rows = await client.query(`
    SELECT id, status, publish_marketplace, publish_started_ts, updated_at
    FROM listings
    WHERE marketplace_key = 'ebay'
      AND status = 'PUBLISH_IN_PROGRESS'
      AND publish_started_ts < NOW() - ($1::text || ' minutes')::interval
    ORDER BY publish_started_ts ASC
    LIMIT 100
  `, [String(staleMinutes)]);

  console.table(rows.rows);
  console.log(`stale in-progress count (${staleMinutes}m): ${rows.rows.length}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
