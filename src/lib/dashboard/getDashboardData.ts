import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { BULL_PREFIX, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { bullConnection } from "@/lib/bull";

type Row = Record<string, unknown>;

type HealthState = "ok" | "error" | "unknown";

type TableCount = {
  table: string;
  count: number | null;
  exists: boolean;
};

type LatestTableRows = {
  table: string;
  exists: boolean;
  orderBy: string | null;
  rows: Row[];
  error?: string;
};

type QualityMetrics = {
  averageMatchConfidence: number | null;
  candidatesByMarketplace: Row[];
  candidatesBySupplier: Row[];
  topProfitableOpportunities: Row[];
};

type JobVisibility = {
  queueName: string;
  counts: Record<string, number>;
  recentFailed: Row[];
  recentSucceeded: Row[];
  error?: string;
};

export type DashboardData = {
  generatedAt: string;
  infrastructure: {
    db: { status: HealthState; detail?: string };
    redis: { status: HealthState; detail?: string };
    environment: {
      nodeEnv: string;
      vercelEnv: string;
    };
  };
  pipelineCounts: TableCount[];
  latestActivity: LatestTableRows[];
  quality: QualityMetrics;
  jobs: JobVisibility;
};

const PIPELINE_TABLES = [
  "trend_signals",
  "trend_candidates",
  "products_raw",
  "marketplace_prices",
  "matches",
  "profitable_candidates",
] as const;

const COMMON_TIME_COLUMNS = [
  "created_at",
  "inserted_at",
  "updated_at",
  "last_seen_ts",
  "first_seen_ts",
  "scanned_at",
  "discovered_at",
  "pulled_at",
  "seen_at",
  "timestamp",
  "ts",
  "id",
];

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

function normalizeRows(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Row[]) : [];
  }
  return [];
}

async function runQuery(query: string): Promise<Row[]> {
  const result = await db.execute(sql.raw(query));
  return normalizeRows(result);
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await runQuery(`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = '${table}'
    ) as exists
  `);
  return Boolean(rows[0]?.exists);
}

async function getTableColumns(table: string): Promise<string[]> {
  const rows = await runQuery(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = '${table}'
    order by ordinal_position
  `);
  return rows.map((r) => String(r.column_name)).filter(Boolean);
}

function pickFirstExisting(columns: string[], candidates: readonly string[]): string | null {
  const set = new Set(columns.map((c) => c.toLowerCase()));
  for (const c of candidates) {
    if (set.has(c.toLowerCase())) return c;
  }
  return null;
}

async function getCount(table: string): Promise<TableCount> {
  const exists = await tableExists(table);
  if (!exists) return { table, count: null, exists: false };

  const rows = await runQuery(`select count(*)::int as count from ${quoteIdent(table)}`);
  return {
    table,
    count: rows[0]?.count == null ? null : Number(rows[0].count),
    exists: true,
  };
}

async function getLatestRows(table: string, limit = 8): Promise<LatestTableRows> {
  const exists = await tableExists(table);
  if (!exists) return { table, exists: false, orderBy: null, rows: [] };

  const columns = await getTableColumns(table);
  const orderBy = pickFirstExisting(columns, COMMON_TIME_COLUMNS);
  const selectedColumns = columns.slice(0, 8).map(quoteIdent).join(", ");
  const safeLimit = Math.max(1, Math.min(limit, 25));

  try {
    const query = orderBy
      ? `
        select ${selectedColumns}
        from ${quoteIdent(table)}
        order by ${quoteIdent(orderBy)} desc nulls last
        limit ${safeLimit}
      `
      : `
        select ${selectedColumns}
        from ${quoteIdent(table)}
        limit ${safeLimit}
      `;

    const rows = await runQuery(query);
    return { table, exists: true, orderBy, rows };
  } catch (error) {
    return {
      table,
      exists: true,
      orderBy,
      rows: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function getAverageMatchConfidence(): Promise<number | null> {
  const exists = await tableExists("matches");
  if (!exists) return null;

  const cols = await getTableColumns("matches");
  if (!cols.includes("confidence")) return null;

  const rows = await runQuery(`
    select round(avg(confidence)::numeric, 4) as avg_confidence
    from "matches"
  `);

  return rows[0]?.avg_confidence == null ? null : Number(rows[0].avg_confidence);
}

async function getCandidatesByField(field: "marketplace_key" | "supplier_key"): Promise<Row[]> {
  const exists = await tableExists("profitable_candidates");
  if (!exists) return [];

  const cols = await getTableColumns("profitable_candidates");
  if (!cols.includes(field)) return [];

  return await runQuery(`
    select ${quoteIdent(field)} as key, count(*)::int as count
    from "profitable_candidates"
    group by ${quoteIdent(field)}
    order by count desc, key asc
    limit 15
  `);
}

async function getTopProfitableOpportunities(): Promise<Row[]> {
  const exists = await tableExists("profitable_candidates");
  if (!exists) return [];

  const cols = await getTableColumns("profitable_candidates");
  if (!cols.includes("estimated_profit")) return [];

  const preferred = [
    "supplier_key",
    "supplier_product_id",
    "marketplace_key",
    "marketplace_listing_id",
    "estimated_profit",
    "margin_pct",
    "roi_pct",
    "decision_status",
    "reason",
  ].filter((c) => cols.includes(c));

  const selectClause = preferred.length ? preferred.map(quoteIdent).join(", ") : "*";

  return await runQuery(`
    select ${selectClause}
    from "profitable_candidates"
    order by "estimated_profit" desc nulls last
    limit 10
  `);
}

async function getQualityMetrics(): Promise<QualityMetrics> {
  const [
    averageMatchConfidence,
    candidatesByMarketplace,
    candidatesBySupplier,
    topProfitableOpportunities,
  ] = await Promise.all([
    getAverageMatchConfidence(),
    getCandidatesByField("marketplace_key"),
    getCandidatesByField("supplier_key"),
    getTopProfitableOpportunities(),
  ]);

  return {
    averageMatchConfidence,
    candidatesByMarketplace,
    candidatesBySupplier,
    topProfitableOpportunities,
  };
}

async function getDbHealth(): Promise<{ status: HealthState; detail?: string }> {
  try {
    await runQuery(`select 1 as ok`);
    return { status: "ok", detail: "Database query succeeded" };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Database health check failed",
    };
  }
}

async function getRedisHealth(): Promise<{ status: HealthState; detail?: string }> {
  try {
    const redisMod = await import("@/lib/redis");
    const getRedis = (redisMod as Record<string, unknown>).getRedis;
    const redisClient =
      typeof getRedis === "function"
        ? (getRedis as () => { ping?: unknown })()
        : (redisMod as Record<string, unknown>).redis ??
          (redisMod as Record<string, unknown>).default ??
          (redisMod as Record<string, unknown>).client;

    if (!redisClient || typeof (redisClient as { ping?: unknown }).ping !== "function") {
      return { status: "unknown", detail: "Redis client export not found in src/lib/redis.ts" };
    }

    const pong = await (redisClient as { ping: () => Promise<string> }).ping();
    return { status: pong === "PONG" ? "ok" : "unknown", detail: String(pong) };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Redis health check failed",
    };
  }
}

async function getJobVisibility(): Promise<JobVisibility> {
  const queueName = JOBS_QUEUE_NAME;

  try {
    const bullmq = await import("bullmq");
    const queue = new bullmq.Queue(queueName, {
      connection: bullConnection,
      prefix: BULL_PREFIX,
    });

    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
      "prioritized",
      "waiting-children"
    );

    const failedJobs = await queue.getJobs(["failed"], 0, 9, true);
    const completedJobs = await queue.getJobs(["completed"], 0, 9, true);

    const recentFailed = failedJobs.map((job) => ({
      id: job.id,
      name: job.name,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
    }));

    const recentSucceeded = completedJobs.map((job) => ({
      id: job.id,
      name: job.name,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
      returnvalue:
        typeof job.returnvalue === "object"
          ? JSON.stringify(job.returnvalue)
          : job.returnvalue,
    }));

    return {
      queueName,
      counts,
      recentFailed,
      recentSucceeded,
    };
  } catch (error) {
    return {
      queueName,
      counts: {},
      recentFailed: [],
      recentSucceeded: [],
      error: error instanceof Error ? error.message : "Could not load BullMQ queue visibility",
    };
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const [dbHealth, redisHealth, pipelineCounts, latestActivity, quality, jobs] =
    await Promise.all([
      getDbHealth().catch((error) => ({
        status: "error" as const,
        detail: error instanceof Error ? error.message : "Database health check failed",
      })),
      getRedisHealth().catch((error) => ({
        status: "error" as const,
        detail: error instanceof Error ? error.message : "Redis health check failed",
      })),
      Promise.all(
        PIPELINE_TABLES.map((t) =>
          getCount(t).catch(() => ({
            table: t,
            count: null,
            exists: false,
          }))
        )
      ),
      Promise.all(
        PIPELINE_TABLES.map((t) =>
          getLatestRows(t, 8).catch((error) => ({
            table: t,
            exists: false,
            orderBy: null,
            rows: [],
            error: error instanceof Error ? error.message : "Latest rows query failed",
          }))
        )
      ),
      getQualityMetrics().catch(() => ({
        averageMatchConfidence: null,
        candidatesByMarketplace: [],
        candidatesBySupplier: [],
        topProfitableOpportunities: [],
      })),
      getJobVisibility().catch((error) => ({
        queueName: JOBS_QUEUE_NAME,
        counts: {},
        recentFailed: [],
        recentSucceeded: [],
        error: error instanceof Error ? error.message : "Could not load BullMQ queue visibility",
      })),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    infrastructure: {
      db: dbHealth,
      redis: redisHealth,
      environment: {
        nodeEnv: process.env.NODE_ENV ?? "unknown",
        vercelEnv: process.env.VERCEL_ENV ?? "unknown",
      },
    },
    pipelineCounts,
    latestActivity,
    quality,
    jobs,
  };
}
