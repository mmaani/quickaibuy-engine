import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

export const REQUIRED_TABLES = [
  "orders",
  "order_items",
  "order_events",
  "supplier_orders",
  "customers",
  "customer_orders",
] as const;

export const REQUIRED_COLUMNS: Record<(typeof REQUIRED_TABLES)[number], readonly string[]> = {
  orders: [
    "id",
    "marketplace",
    "marketplace_order_id",
    "buyer_name",
    "buyer_country",
    "total_price",
    "currency",
    "status",
    "created_at",
  ],
  order_items: [
    "id",
    "order_id",
    "listing_id",
    "supplier_key",
    "supplier_product_id",
    "quantity",
    "item_price",
  ],
  order_events: ["id", "order_id", "event_type", "event_ts", "details"],
  supplier_orders: [
    "id",
    "order_id",
    "supplier_key",
    "supplier_order_ref",
    "purchase_status",
    "tracking_number",
    "tracking_status",
    "tracking_carrier",
    "manual_note",
    "purchase_recorded_at",
    "tracking_recorded_at",
    "tracking_sync_last_attempt_at",
    "tracking_synced_at",
    "tracking_sync_error",
    "tracking_sync_last_response",
  ],
  customers: [
    "id",
    "marketplace",
    "customer_external_id",
    "buyer_name",
    "buyer_email_normalized",
    "city",
    "state",
    "country",
    "first_order_at",
    "last_order_at",
    "order_count",
    "total_spent",
    "currency",
    "revenue_policy",
  ],
  customer_orders: [
    "id",
    "customer_id",
    "order_id",
    "marketplace",
    "merge_source",
    "identity_confidence",
    "resolution_method",
    "order_created_at",
    "order_total",
    "order_currency",
  ],
};

type IndexRequirement = {
  key: string;
  table: string;
  columns: string[];
  mustBeUnique?: boolean;
  allowUniqueForLookup?: boolean;
};

const REQUIRED_INDEXES: IndexRequirement[] = [
  {
    key: "orders_marketplace_marketplace_order_unique",
    table: "orders",
    columns: ["marketplace", "marketplace_order_id"],
    mustBeUnique: true,
  },
  {
    key: "orders_marketplace_marketplace_order_lookup",
    table: "orders",
    columns: ["marketplace", "marketplace_order_id"],
    allowUniqueForLookup: true,
  },
  {
    key: "order_items_order_id_lookup",
    table: "order_items",
    columns: ["order_id"],
    allowUniqueForLookup: true,
  },
  {
    key: "order_events_order_id_lookup",
    table: "order_events",
    columns: ["order_id"],
    allowUniqueForLookup: true,
  },
  {
    key: "supplier_orders_order_id_lookup",
    table: "supplier_orders",
    columns: ["order_id"],
    allowUniqueForLookup: true,
  },
  {
    key: "supplier_orders_order_supplier_attempt_unique",
    table: "supplier_orders",
    columns: ["order_id", "supplier_key", "attempt_no"],
    mustBeUnique: true,
  },
  {
    key: "supplier_orders_purchase_status_lookup",
    table: "supplier_orders",
    columns: ["purchase_status"],
    allowUniqueForLookup: true,
  },
  {
    key: "supplier_orders_tracking_status_lookup",
    table: "supplier_orders",
    columns: ["tracking_status"],
    allowUniqueForLookup: true,
  },
  {
    key: "customers_marketplace_email_unique",
    table: "customers",
    columns: ["marketplace", "buyer_email_normalized"],
    mustBeUnique: true,
  },
  {
    key: "customers_marketplace_external_unique",
    table: "customers",
    columns: ["marketplace", "customer_external_id"],
    mustBeUnique: true,
  },
  {
    key: "customer_orders_order_unique",
    table: "customer_orders",
    columns: ["order_id"],
    mustBeUnique: true,
  },
  {
    key: "customer_orders_customer_idx",
    table: "customer_orders",
    columns: ["customer_id"],
    allowUniqueForLookup: true,
  },
];

const REQUIRED_FOREIGN_KEYS = [
  { table: "order_items", column: "order_id", referencesTable: "orders" },
  { table: "order_events", column: "order_id", referencesTable: "orders" },
  { table: "supplier_orders", column: "order_id", referencesTable: "orders" },
  { table: "customer_orders", column: "order_id", referencesTable: "orders" },
  { table: "customer_orders", column: "customer_id", referencesTable: "customers" },
] as const;

type IndexInfo = {
  tableName: string;
  indexName: string;
  isUnique: boolean;
  columns: string[] | string;
};

type ForeignKeyInfo = {
  tableName: string;
  columnName: string;
  foreignTableName: string;
};

export type OrderSchemaCheckResult = {
  checkedAt: string;
  database: string | null;
  schemaComplete: boolean;
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string }>;
  missingIndexes: Array<{
    key: string;
    table: string;
    columns: string[];
    requirement: "unique" | "lookup";
  }>;
  missingForeignKeys: Array<{ table: string; column: string; referencesTable: string }>;
  expected: {
    tables: string[];
    columns: Record<string, string[]>;
    indexes: Array<{ key: string; table: string; columns: string[]; requirement: "unique" | "lookup" }>;
    foreignKeys: Array<{ table: string; column: string; referencesTable: string }>;
  };
  observed: {
    tables: string[];
    indexes: Array<{ table: string; indexName: string; isUnique: boolean; columns: string[] }>;
  };
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

function columnsMatch(indexColumns: string[], requiredColumns: string[]): boolean {
  if (indexColumns.length < requiredColumns.length) {
    return false;
  }
  return requiredColumns.every((column, idx) => indexColumns[idx] === column);
}

function normalizeColumns(rawColumns: string[] | string): string[] {
  if (Array.isArray(rawColumns)) {
    return rawColumns;
  }

  if (!rawColumns) {
    return [];
  }

  const trimmed = rawColumns.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return [trimmed];
  }

  const inner = trimmed.slice(1, -1);
  if (!inner) {
    return [];
  }

  return inner
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function matchesIndexRequirement(index: IndexInfo, requirement: IndexRequirement): boolean {
  if (index.tableName !== requirement.table) {
    return false;
  }
  const columns = normalizeColumns(index.columns);
  if (!columnsMatch(columns, requirement.columns)) {
    return false;
  }
  if (requirement.mustBeUnique) {
    return index.isUnique;
  }
  if (requirement.allowUniqueForLookup) {
    return true;
  }
  return !index.isUnique;
}

export async function checkOrderAutomationSchema(): Promise<OrderSchemaCheckResult> {
  const pool = new Pool({
    connectionString: getConnectionString(),
    ssl: isSslDisabled() ? false : { rejectUnauthorized: false },
  });

  try {
    const dbRes = await pool.query<{ db_name: string }>(`SELECT current_database() AS db_name`);

    const tableRes = await pool.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [Array.from(REQUIRED_TABLES)]
    );

    const observedTables = new Set(tableRes.rows.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((table) => !observedTables.has(table));

    const columnRes = await pool.query<{ table_name: string; column_name: string }>(
      `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [Array.from(REQUIRED_TABLES)]
    );

    const observedColumnsByTable = new Map<string, Set<string>>();
    for (const row of columnRes.rows) {
      const current = observedColumnsByTable.get(row.table_name) ?? new Set<string>();
      current.add(row.column_name);
      observedColumnsByTable.set(row.table_name, current);
    }

    const missingColumns: Array<{ table: string; column: string }> = [];
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const observed = observedColumnsByTable.get(table) ?? new Set<string>();
      for (const column of columns) {
        if (!observed.has(column)) {
          missingColumns.push({ table, column });
        }
      }
    }

    const indexRes = await pool.query<IndexInfo>(
      `
        SELECT
          t.relname AS "tableName",
          i.relname AS "indexName",
          ix.indisunique AS "isUnique",
          COALESCE(
            ARRAY_AGG(a.attname ORDER BY ord.n)
              FILTER (WHERE a.attname IS NOT NULL),
            ARRAY[]::text[]
          ) AS columns
        FROM pg_class t
        JOIN pg_namespace ns ON ns.oid = t.relnamespace
        JOIN pg_index ix ON ix.indrelid = t.oid
        JOIN pg_class i ON i.oid = ix.indexrelid
        LEFT JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY ord(attnum, n) ON true
        LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ord.attnum
        WHERE ns.nspname = 'public'
          AND t.relkind = 'r'
          AND t.relname = ANY($1::text[])
        GROUP BY t.relname, i.relname, ix.indisunique
      `,
      [Array.from(REQUIRED_TABLES)]
    );

    const missingIndexes = REQUIRED_INDEXES.filter(
      (requirement) => !indexRes.rows.some((index) => matchesIndexRequirement(index, requirement))
    ).map((requirement) => ({
      key: requirement.key,
      table: requirement.table,
      columns: requirement.columns,
      requirement: requirement.mustBeUnique ? ("unique" as const) : ("lookup" as const),
    }));

    const fkRes = await pool.query<ForeignKeyInfo>(
      `
        SELECT
          tc.table_name AS "tableName",
          kcu.column_name AS "columnName",
          ccu.table_name AS "foreignTableName"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = ANY($1::text[])
      `,
      [REQUIRED_FOREIGN_KEYS.map((item) => item.table)]
    );

    const missingForeignKeys = REQUIRED_FOREIGN_KEYS.filter(
      (requiredFk) =>
        !fkRes.rows.some(
          (fk) =>
            fk.tableName === requiredFk.table &&
            fk.columnName === requiredFk.column &&
            fk.foreignTableName === requiredFk.referencesTable
        )
    );

    const schemaComplete =
      missingTables.length === 0 &&
      missingColumns.length === 0 &&
      missingIndexes.length === 0 &&
      missingForeignKeys.length === 0;

    return {
      checkedAt: new Date().toISOString(),
      database: dbRes.rows[0]?.db_name ?? null,
      schemaComplete,
      missingTables,
      missingColumns,
      missingIndexes,
      missingForeignKeys,
      expected: {
        tables: Array.from(REQUIRED_TABLES),
        columns: Object.fromEntries(
          Object.entries(REQUIRED_COLUMNS).map(([table, columns]) => [table, Array.from(columns)])
        ),
        indexes: REQUIRED_INDEXES.map((idx) => ({
          key: idx.key,
          table: idx.table,
          columns: idx.columns,
          requirement: idx.mustBeUnique ? ("unique" as const) : ("lookup" as const),
        })),
        foreignKeys: REQUIRED_FOREIGN_KEYS.map((fk) => ({ ...fk })),
      },
      observed: {
        tables: Array.from(observedTables).sort(),
        indexes: indexRes.rows
          .map((index) => ({
            table: index.tableName,
            indexName: index.indexName,
            isUnique: index.isUnique,
            columns: normalizeColumns(index.columns),
          }))
          .sort((a, b) =>
            `${a.table}:${a.indexName}`.localeCompare(`${b.table}:${b.indexName}`)
          ),
      },
    };
  } finally {
    await pool.end();
  }
}
