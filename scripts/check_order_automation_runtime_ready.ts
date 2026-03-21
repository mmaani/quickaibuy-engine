import { Pool } from "pg";
import { checkOrderAutomationSchema, REQUIRED_COLUMNS } from "./lib/orderAutomationSchemaCheck";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

type LedgerInfo = {
  exists: boolean;
  entries: number;
};

type RuntimeReadiness = {
  checkedAt: string;
  schemaReady: boolean;
  migrationDriftRisk: boolean;
  migrationDriftReasons: string[];
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string }>;
  missingIndexes: Array<{
    key: string;
    table: string;
    columns: string[];
    requirement: "unique" | "lookup";
  }>;
  missingForeignKeys: Array<{ table: string; column: string; referencesTable: string }>;
  readiness: {
    orderSync: boolean;
    manualPurchaseFlow: boolean;
    trackingSync: boolean;
    adminOrders: boolean;
  };
  ledger: LedgerInfo;
  safeForOrderAutomationRuntime: boolean;
};

function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL_DIRECT or DATABASE_URL");
  }
  return connectionString;
}

function isSslDisabled(): boolean {
  return String(process.env.PGSSLMODE || "").toLowerCase() === "disable";
}

function hasColumn(
  missingColumns: Array<{ table: string; column: string }>,
  table: string,
  column: string
): boolean {
  return !missingColumns.some((item) => item.table === table && item.column === column);
}

async function getDrizzleLedgerInfo(pool: Pool): Promise<LedgerInfo> {
  const existsRes = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = '__drizzle_migrations'
    ) AS exists
  `);

  const exists = Boolean(existsRes.rows[0]?.exists);
  if (!exists) {
    return { exists: false, entries: 0 };
  }

  const countRes = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM __drizzle_migrations`);
  return {
    exists: true,
    entries: Number(countRes.rows[0]?.n ?? 0),
  };
}

async function main() {
  const schema = await checkOrderAutomationSchema();

  const pool = new Pool({
    connectionString: getConnectionString(),
    ssl: isSslDisabled() ? false : { rejectUnauthorized: false },
  });

  try {
    const ledger = await getDrizzleLedgerInfo(pool);
    const migrationDriftReasons: string[] = [];

    if (!ledger.exists) {
      migrationDriftReasons.push(
        "__drizzle_migrations table is missing; migration history cannot be verified deterministically."
      );
    } else if (ledger.entries === 0) {
      migrationDriftReasons.push(
        "__drizzle_migrations exists but has zero rows; migration application history appears incomplete."
      );
    }

    if (!schema.schemaComplete) {
      migrationDriftReasons.push(
        "Required order-automation schema objects are missing, which indicates partial migration application or drift."
      );
    }

    const coreOrdersColumns = REQUIRED_COLUMNS.orders;
    const orderSyncReady =
      schema.missingTables.length === 0 &&
      coreOrdersColumns.every((column) => hasColumn(schema.missingColumns, "orders", column)) &&
      hasColumn(schema.missingColumns, "order_items", "order_id") &&
      hasColumn(schema.missingColumns, "order_events", "event_type");

    const manualPurchaseFlowReady =
      orderSyncReady &&
      [
        "purchase_status",
        "supplier_order_ref",
        "manual_note",
        "purchase_recorded_at",
        "tracking_recorded_at",
      ].every((column) => hasColumn(schema.missingColumns, "supplier_orders", column));

    const trackingSyncReady =
      manualPurchaseFlowReady &&
      [
        "tracking_number",
        "tracking_carrier",
        "tracking_status",
        "tracking_sync_last_attempt_at",
        "tracking_synced_at",
        "tracking_sync_error",
        "tracking_sync_last_response",
      ].every((column) => hasColumn(schema.missingColumns, "supplier_orders", column));

    const adminOrdersReady = orderSyncReady && manualPurchaseFlowReady && trackingSyncReady;

    const migrationDriftRisk = migrationDriftReasons.length > 0;
    const safeForOrderAutomationRuntime =
      schema.schemaComplete &&
      orderSyncReady &&
      manualPurchaseFlowReady &&
      trackingSyncReady &&
      adminOrdersReady;

    const payload: RuntimeReadiness = {
      checkedAt: new Date().toISOString(),
      schemaReady: schema.schemaComplete,
      migrationDriftRisk,
      migrationDriftReasons,
      missingTables: schema.missingTables,
      missingColumns: schema.missingColumns,
      missingIndexes: schema.missingIndexes,
      missingForeignKeys: schema.missingForeignKeys,
      readiness: {
        orderSync: orderSyncReady,
        manualPurchaseFlow: manualPurchaseFlowReady,
        trackingSync: trackingSyncReady,
        adminOrders: adminOrdersReady,
      },
      ledger,
      safeForOrderAutomationRuntime,
    };

    console.log(JSON.stringify(payload, null, 2));

    if (!safeForOrderAutomationRuntime) {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
