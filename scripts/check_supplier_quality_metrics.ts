import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const queries = [
    {
      title: "supplier_quality_summary",
      sql: `
        SELECT
          count(*)::int AS supplier_snapshots_processed,
          count(*) FILTER (WHERE upper(coalesce(raw_payload->>'snapshotQuality', '')) = 'HIGH')::int AS high_quality_snapshots,
          count(*) FILTER (WHERE upper(coalesce(raw_payload->>'snapshotQuality', '')) = 'MEDIUM')::int AS medium_quality_snapshots,
          count(*) FILTER (WHERE upper(coalesce(raw_payload->>'snapshotQuality', '')) = 'LOW')::int AS low_quality_snapshots,
          count(*) FILTER (WHERE upper(coalesce(raw_payload->>'snapshotQuality', '')) = 'STUB')::int AS stub_snapshots
        FROM products_raw
      `,
    },
    {
      title: "supplier_quality_missing_fields",
      sql: `
        SELECT
          count(*) FILTER (
            WHERE coalesce(raw_payload->>'snapshotQuality', '') = ''
          )::int AS missing_snapshot_quality,
          count(*) FILTER (
            WHERE jsonb_typeof(coalesce(raw_payload->'telemetrySignals', 'null'::jsonb)) <> 'array'
          )::int AS missing_telemetry_signals
        FROM products_raw
      `,
    },
    {
      title: "recent_supplier_quality_rows",
      sql: `
        SELECT
          supplier_key,
          supplier_product_id,
          raw_payload->>'snapshotQuality' AS snapshot_quality,
          raw_payload->'telemetrySignals' AS telemetry_signals,
          availability_status,
          snapshot_ts
        FROM products_raw
        ORDER BY snapshot_ts DESC NULLS LAST, id DESC
        LIMIT 15
      `,
    },
  ];

  for (const query of queries) {
    const result = await client.query(query.sql);
    console.log(`\n=== ${query.title} ===`);
    console.table(result.rows);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
