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
    "supplier_trust_score",
    "supplier_trust_band",
    "supplier_delivery_score",
    "supplier_stock_score",
    "supplier_price_stability_score",
    "supplier_issue_penalty",
    "supplier_trust_evaluated_at",
    "supplier_trust_reason_codes",
  ],
  listings: [
    "publish_marketplace",
    "publish_started_ts",
    "publish_finished_ts",
    "published_external_id",
    "publish_attempt_count",
    "last_publish_error",
    "listing_date",
    "performance_impressions",
    "performance_clicks",
    "performance_orders",
    "performance_ctr",
    "performance_conversion_rate",
    "performance_last_signal_at",
    "kill_score",
    "kill_decision",
    "kill_reason_codes",
    "kill_evaluated_at",
    "auto_killed_at",
    "evolution_attempt_count",
    "last_evolution_at",
    "listing_evolution_status",
    "listing_evolution_reason",
    "listing_evolution_candidate_payload",
    "listing_evolution_applied_at",
    "listing_evolution_result",
  ],
  listing_daily_caps: ["id", "marketplace_key", "cap_date", "cap_limit", "cap_used"],
  worker_runs: ["id", "worker", "job_name", "job_id", "status", "stats", "started_at"],
  orders: ["id", "listing_id", "marketplace_key", "order_id", "status"],
};

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.QAB_DATABASE_URL ||
    process.env.DATABASE_URL_DIRECT ||
    process.env.QAB_DATABASE_URL_DIRECT;
  if (!connectionString) {
    throw new Error(
      "Missing DATABASE_URL/DATABASE_URL_DIRECT (or QAB_DATABASE_URL/QAB_DATABASE_URL_DIRECT aliases)"
    );
  }
  const client = new Client({ connectionString });
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
