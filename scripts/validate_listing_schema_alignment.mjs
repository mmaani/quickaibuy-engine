import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

const expected = {
  profitable_candidates: [
    "approved_ts",
    "approved_by",
    "listing_eligible",
    "listing_eligible_ts",
    "listing_block_reason",
  ],
  listings: [
    "publish_marketplace",
    "publish_started_ts",
    "publish_finished_ts",
    "published_external_id",
    "publish_attempt_count",
    "last_publish_error",
    "listing_date",
  ],
  listing_daily_caps: ["id", "marketplace_key", "cap_date", "cap_limit", "cap_used"],
  worker_runs: ["id", "worker", "job_name", "job_id", "status", "stats", "started_at"],
  orders: ["id", "listing_id", "marketplace_key", "order_id", "status"],
};

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const result = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
    ORDER BY table_name, ordinal_position
  `, [Object.keys(expected)]);

  const columnsByTable = new Map();
  for (const row of result.rows) {
    const arr = columnsByTable.get(row.table_name) ?? [];
    arr.push(row.column_name);
    columnsByTable.set(row.table_name, arr);
  }

  const summary = [];
  let allGood = true;

  for (const [table, required] of Object.entries(expected)) {
    const actual = columnsByTable.get(table) ?? [];
    const missing = required.filter((c) => !actual.includes(c));
    if (missing.length) allGood = false;
    summary.push({ table, required: required.length, actual: actual.length, missing: missing.join(", ") || "-" });
  }

  console.table(summary);
  await client.end();

  if (!allGood) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
