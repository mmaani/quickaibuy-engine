import { withRuntimePgClient } from "./lib/db.mjs";

const DEFAULT_SUMMARY_QUERIES = [
  {
    label: "pipeline_counts",
    sql: `
      SELECT 'trend_signals' AS table_name, COUNT(*)::int AS count FROM trend_signals
      UNION ALL SELECT 'trend_candidates', COUNT(*)::int FROM trend_candidates
      UNION ALL SELECT 'products_raw', COUNT(*)::int FROM products_raw
      UNION ALL SELECT 'marketplace_prices', COUNT(*)::int FROM marketplace_prices
      UNION ALL SELECT 'matches', COUNT(*)::int FROM matches
      UNION ALL SELECT 'profitable_candidates', COUNT(*)::int FROM profitable_candidates
      ORDER BY table_name
    `,
  },
  {
    label: "recent_trend_signals",
    sql: `
      SELECT id, source, signal_type, signal_value, captured_ts
      FROM trend_signals
      ORDER BY captured_ts DESC NULLS LAST, id DESC
      LIMIT 10
    `,
  },
  {
    label: "recent_matches",
    sql: `
      SELECT
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        match_type,
        confidence,
        status,
        last_seen_ts
      FROM matches
      ORDER BY last_seen_ts DESC NULLS LAST
      LIMIT 10
    `,
  },
  {
    label: "recent_profitable_candidates",
    sql: `
      SELECT
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        estimated_profit,
        margin_pct,
        roi_pct,
        decision_status,
        calc_ts
      FROM profitable_candidates
      ORDER BY calc_ts DESC NULLS LAST
      LIMIT 10
    `,
  },
];

function printRows(label, rows) {
  console.log(`\n=== ${label} (${rows.length}) ===`);
  console.table(rows);
}

async function run() {
  const sql = process.argv.slice(2).join(" ").trim();
  await withRuntimePgClient(async (client) => {
    if (!sql) {
      for (const q of DEFAULT_SUMMARY_QUERIES) {
        const res = await client.query(q.sql);
        printRows(q.label, res.rows);
      }
      return;
    }

    const res = await client.query(sql);
    console.log("ROW COUNT:", res.rowCount ?? 0);
    console.dir(res.rows, { depth: null, colors: true, maxArrayLength: 200 });
  });
}

run().catch((err) => {
  console.error("DB INSPECT ERROR");
  console.error(err);
  process.exit(1);
});
