import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

type MissingColumn = { table: string; column: string };

const REQUIRED_TABLES = [
  "orders",
  "order_items",
  "order_events",
  "supplier_orders",
  "manual_overrides",
  "jobs",
  "worker_runs",
] as const;

const REQUIRED_COLUMNS: MissingColumn[] = [
  { table: "orders", column: "marketplace" },
  { table: "orders", column: "marketplace_order_id" },
  { table: "orders", column: "total_price" },
  { table: "supplier_orders", column: "manual_note" },
  { table: "supplier_orders", column: "purchase_recorded_at" },
  { table: "supplier_orders", column: "tracking_recorded_at" },
  { table: "supplier_orders", column: "tracking_carrier" },
  { table: "supplier_orders", column: "tracking_sync_last_attempt_at" },
  { table: "supplier_orders", column: "tracking_synced_at" },
  { table: "supplier_orders", column: "tracking_sync_error" },
  { table: "supplier_orders", column: "tracking_sync_last_response" },
];

const EXPECTED_DRIZZLE_TAGS = [
  "0000_even_iron_man",
  "0001_concerned_skin",
  "0002_breezy_wraith",
  "0003_wild_kulan_gath",
  "0004_aromatic_reavers",
] as const;

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.stack || error.name;
  }
  return String(error);
}

async function main() {
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      JSON.stringify(
        {
          status: "FAILED",
          reason: "Missing DATABASE_URL or DATABASE_URL_DIRECT",
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const journalPath = path.join(repoRoot, "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries?: Array<{ tag?: string }>;
  };
  const journalTags = (journal.entries ?? []).map((entry) => entry.tag).filter(Boolean);

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const tableRows = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tables = new Set(tableRows.rows.map((row) => row.table_name));

    const columnRows = await pool.query<{ table_name: string; column_name: string; is_nullable: string }>(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `);

    const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table));
    const missingColumns = REQUIRED_COLUMNS.filter(
      ({ table, column }) =>
        !columnRows.rows.some((row) => row.table_name === table && row.column_name === column)
    );

    const drizzleMigrationsTableExists = tables.has("__drizzle_migrations");
    const drizzleLedgerCount = drizzleMigrationsTableExists
      ? (
          await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM __drizzle_migrations")
        ).rows[0]?.n ?? 0
      : 0;

    const orderItemsSupplierNullable = columnRows.rows.find(
      (row) => row.table_name === "order_items" && row.column_name === "supplier_key"
    )?.is_nullable;
    const orderItemsProductNullable = columnRows.rows.find(
      (row) => row.table_name === "order_items" && row.column_name === "supplier_product_id"
    )?.is_nullable;

    const repoJournalMatchesExpected =
      EXPECTED_DRIZZLE_TAGS.length === journalTags.length &&
      EXPECTED_DRIZZLE_TAGS.every((tag, idx) => journalTags[idx] === tag);

    const legacyDrizzleLedgerHealthy = drizzleMigrationsTableExists && drizzleLedgerCount >= 5;
    const safeForForwardOnlySqlPath =
      missingTables.length === 0 &&
      missingColumns.length === 0 &&
      orderItemsSupplierNullable === "YES" &&
      orderItemsProductNullable === "YES";

    const payload = {
      status: safeForForwardOnlySqlPath ? "OK" : "FAILED",
      baseline: "quickaibuy-v1-hybrid-baseline",
      baselineDefinition:
        "Drizzle bootstrap through 0004_aromatic_reavers plus additive SQL migrations through 20260311f_add_manual_overrides.",
      authoritativePathGoingForward: "migrations/*.sql (forward-only, additive)",
      legacyAwarenessOnly: {
        repoJournalMatchesExpected,
        expectedDrizzleTags: EXPECTED_DRIZZLE_TAGS,
        repoJournalTags: journalTags,
        drizzleMigrationsTableExists,
        drizzleLedgerCount,
        legacyDrizzleLedgerHealthy,
      },
      runtimeBaselineChecks: {
        missingTables,
        missingColumns,
        orderItemsSupplierKeyNullable: orderItemsSupplierNullable === "YES",
        orderItemsSupplierProductIdNullable: orderItemsProductNullable === "YES",
      },
      safeForForwardOnlySqlPath,
    };

    console.log(JSON.stringify(payload, null, 2));
    if (!safeForForwardOnlySqlPath) {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "FAILED",
        reason: errorToString(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
