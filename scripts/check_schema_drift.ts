import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

type ExpectedColumn = {
  name: string;
  type: string;
  nullable: boolean;
};

type ExpectedIndex = {
  table: string;
  columns: string[];
  unique?: boolean;
};

type TableSpec = {
  columns: ExpectedColumn[];
  indexes: ExpectedIndex[];
};

const TABLE_SPECS: Record<string, TableSpec> = {
  listings: {
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "candidate_id", type: "uuid", nullable: false },
      { name: "marketplace_key", type: "text", nullable: false },
      { name: "status", type: "text", nullable: false },
      { name: "title", type: "text", nullable: false },
      { name: "price", type: "numeric", nullable: false },
      { name: "quantity", type: "int4", nullable: false },
      { name: "payload", type: "jsonb", nullable: false },
      { name: "performance_impressions", type: "int8", nullable: true },
      { name: "performance_clicks", type: "int8", nullable: true },
      { name: "performance_orders", type: "int8", nullable: true },
      { name: "performance_ctr", type: "numeric", nullable: true },
      { name: "performance_conversion_rate", type: "numeric", nullable: true },
      { name: "performance_last_signal_at", type: "timestamp", nullable: true },
      { name: "kill_score", type: "numeric", nullable: true },
      { name: "kill_decision", type: "text", nullable: true },
      { name: "kill_reason_codes", type: "_text", nullable: true },
      { name: "kill_evaluated_at", type: "timestamp", nullable: true },
      { name: "auto_killed_at", type: "timestamp", nullable: true },
      { name: "evolution_attempt_count", type: "int4", nullable: false },
      { name: "last_evolution_at", type: "timestamp", nullable: true },
      { name: "listing_evolution_status", type: "text", nullable: true },
      { name: "listing_evolution_reason", type: "text", nullable: true },
      { name: "listing_evolution_candidate_payload", type: "jsonb", nullable: true },
      { name: "listing_evolution_applied_at", type: "timestamp", nullable: true },
      { name: "listing_evolution_result", type: "text", nullable: true },
      { name: "idempotency_key", type: "text", nullable: false },
      { name: "created_at", type: "timestamp", nullable: false },
      { name: "updated_at", type: "timestamp", nullable: false },
    ],
    indexes: [],
  },
  profitable_candidates: {
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "supplier_key", type: "text", nullable: false },
      { name: "supplier_product_id", type: "text", nullable: false },
      { name: "marketplace_key", type: "text", nullable: false },
      { name: "marketplace_listing_id", type: "text", nullable: false },
      { name: "decision_status", type: "text", nullable: false },
      { name: "listing_eligible", type: "bool", nullable: false },
      { name: "supplier_trust_score", type: "numeric", nullable: true },
      { name: "supplier_trust_band", type: "text", nullable: true },
      { name: "supplier_delivery_score", type: "numeric", nullable: true },
      { name: "supplier_stock_score", type: "numeric", nullable: true },
      { name: "supplier_price_stability_score", type: "numeric", nullable: true },
      { name: "supplier_issue_penalty", type: "numeric", nullable: true },
      { name: "supplier_trust_evaluated_at", type: "timestamp", nullable: true },
      { name: "supplier_trust_reason_codes", type: "_text", nullable: true },
    ],
    indexes: [],
  },
  marketplace_prices: {
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "marketplace_key", type: "text", nullable: false },
      { name: "marketplace_listing_id", type: "text", nullable: false },
      { name: "currency", type: "text", nullable: false },
      { name: "price", type: "numeric", nullable: false },
      { name: "raw_payload", type: "jsonb", nullable: false },
      { name: "snapshot_ts", type: "timestamp", nullable: false },
    ],
    indexes: [],
  },
  orders: {
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "marketplace", type: "text", nullable: false },
      { name: "marketplace_order_id", type: "text", nullable: false },
      { name: "status", type: "text", nullable: false },
      { name: "created_at", type: "timestamp", nullable: false },
    ],
    indexes: [
      { table: "orders", columns: ["marketplace", "marketplace_order_id"], unique: true },
      { table: "orders", columns: ["marketplace", "marketplace_order_id"] },
    ],
  },
  order_items: {
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "order_id", type: "uuid", nullable: false },
      { name: "listing_id", type: "uuid", nullable: true },
      { name: "supplier_key", type: "text", nullable: true },
      { name: "supplier_product_id", type: "text", nullable: true },
      { name: "quantity", type: "int4", nullable: false },
      { name: "item_price", type: "numeric", nullable: false },
    ],
    indexes: [{ table: "order_items", columns: ["order_id"] }],
  },
  audit_log: {
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "event_ts", type: "timestamp", nullable: false },
      { name: "entity_type", type: "text", nullable: false },
      { name: "entity_id", type: "text", nullable: false },
      { name: "event_type", type: "text", nullable: false },
    ],
    indexes: [],
  },
  jobs: {
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "job_type", type: "text", nullable: false },
      { name: "idempotency_key", type: "text", nullable: false },
      { name: "status", type: "text", nullable: false },
    ],
    indexes: [{ table: "jobs", columns: ["job_type", "idempotency_key"], unique: true }],
  },
  worker_runs: {
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "worker", type: "text", nullable: false },
      { name: "job_name", type: "text", nullable: false },
      { name: "job_id", type: "text", nullable: false },
      { name: "status", type: "text", nullable: false },
      { name: "started_at", type: "timestamp", nullable: false },
    ],
    indexes: [{ table: "worker_runs", columns: ["job_name", "job_id"] }],
  },
};

function normalizeType(dataType: string, udtName: string): string {
  if (dataType === "ARRAY") return udtName;
  if (dataType === "USER-DEFINED") return udtName;
  return udtName || dataType;
}

function columnsMatch(indexCols: string[], requiredCols: string[]): boolean {
  if (indexCols.length < requiredCols.length) return false;
  return requiredCols.every((c, i) => indexCols[i] === c);
}

async function main() {
  const connectionString =
    process.env.DATABASE_URL_DIRECT ||
    process.env.QAB_DATABASE_URL_DIRECT ||
    process.env.DATABASE_URL ||
    process.env.QAB_DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL_DIRECT or DATABASE_URL");

  const pool = new Pool({
    connectionString,
    ssl: String(process.env.PGSSLMODE || "").toLowerCase() === "disable" ? false : { rejectUnauthorized: false },
  });

  try {
    const tables = Object.keys(TABLE_SPECS);

    const tableRows = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    `, [tables]);
    const existingTables = new Set(tableRows.rows.map((r) => r.table_name));

    const colRows = await pool.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      data_type: string;
      udt_name: string;
    }>(`
      SELECT table_name, column_name, is_nullable, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    `, [tables]);

    const idxRows = await pool.query<{
      table_name: string;
      index_name: string;
      is_unique: boolean;
      columns: string[];
    }>(`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        ARRAY_AGG(a.attname ORDER BY ord.n)
          FILTER (WHERE a.attname IS NOT NULL) AS columns
      FROM pg_class t
      JOIN pg_namespace ns ON ns.oid = t.relnamespace
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      LEFT JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY ord(attnum, n) ON true
      LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ord.attnum
      WHERE ns.nspname = 'public' AND t.relkind = 'r' AND t.relname = ANY($1::text[])
      GROUP BY t.relname, i.relname, ix.indisunique
    `, [tables]);

    const missingTables: string[] = [];
    const missingColumns: Array<{ table: string; column: string }> = [];
    const extraColumns: Array<{ table: string; column: string }> = [];
    const typeMismatches: Array<{ table: string; column: string; expected: string; actual: string }> = [];
    const nullableMismatches: Array<{ table: string; column: string; expected: boolean; actual: boolean }> = [];
    const missingIndexes: ExpectedIndex[] = [];

    for (const [table, spec] of Object.entries(TABLE_SPECS)) {
      if (!existingTables.has(table)) {
        missingTables.push(table);
        continue;
      }
      const observed = colRows.rows.filter((c) => c.table_name === table);
      const obsMap = new Map(observed.map((c) => [c.column_name, c]));
      const expectedNames = new Set(spec.columns.map((c) => c.name));

      for (const exp of spec.columns) {
        const col = obsMap.get(exp.name);
        if (!col) {
          missingColumns.push({ table, column: exp.name });
          continue;
        }
        const actualType = normalizeType(col.data_type, col.udt_name);
        if (actualType !== exp.type) {
          typeMismatches.push({ table, column: exp.name, expected: exp.type, actual: actualType });
        }
        const actualNullable = col.is_nullable === "YES";
        if (actualNullable !== exp.nullable) {
          nullableMismatches.push({ table, column: exp.name, expected: exp.nullable, actual: actualNullable });
        }
      }

      for (const col of observed) {
        if (!expectedNames.has(col.column_name)) {
          extraColumns.push({ table, column: col.column_name });
        }
      }

      const tableIndexes = idxRows.rows.filter((r) => r.table_name === table);
      for (const idx of spec.indexes) {
        const found = tableIndexes.some((r) => {
          const uniqueMatch = idx.unique === undefined ? true : r.is_unique === idx.unique;
          return uniqueMatch && columnsMatch(r.columns ?? [], idx.columns);
        });
        if (!found) missingIndexes.push(idx);
      }
    }

    const ok =
      missingTables.length === 0 &&
      missingColumns.length === 0 &&
      typeMismatches.length === 0 &&
      nullableMismatches.length === 0;

    const payload = {
      status: ok ? "OK" : "FAILED",
      checkedTables: tables,
      note: "marketplace_snapshots is validated against marketplace_prices (current canonical table)",
      missingTables,
      missingColumns,
      extraColumns,
      extraColumnsNote:
        extraColumns.length > 0
          ? "Extra columns are informational only. Drift fails closed on missing required schema, not forward-compatible additions."
          : undefined,
      typeMismatches,
      nullableMismatches,
      missingIndexes,
      missingIndexesNote:
        missingIndexes.length > 0
          ? "Index drift is informational in this check. Runtime safety and required schema completeness are enforced by the dedicated schema readiness checks."
          : undefined,
    };

    console.log(JSON.stringify(payload, null, 2));
    if (!ok) process.exit(1);
  } finally {
    await pool.end();
  }
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.stack || error.name;
  }
  return String(error);
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
