export { getControlPanelData } from "@/lib/control/getControlPanelData";
export type { ControlPanelData } from "@/lib/control/getControlPanelData";
import { sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { db } from "@/lib/db";
import { bullConnection } from "@/lib/bull";
import { BULL_PREFIX, JOBS_QUEUE_NAME } from "@/lib/jobNames";

export type Row = Record<string, unknown>;
type HealthState = "ok" | "error" | "unknown";

type CountEntry = { key: string; count: number | null; exists: boolean };

type AlertTone = "warning" | "error";

export type ControlPanelAlert = {
  id: string;
  tone: AlertTone;
  title: string;
  detail: string;
};

export type ControlPanelData = {
  generatedAt: string;
  infrastructure: {
    db: { status: HealthState; detail?: string };
    redis: { status: HealthState; detail?: string };
    queue: { status: HealthState; detail?: string; counts: Record<string, number> };
  };
  pipelineOverview: {
    counts: CountEntry[];
    activeMatches: number | null;
    listingsByStatus: Row[];
  };
  matchQuality: {
    confidenceDistribution: Row[];
    activeInactive: Row[];
    lowConfidenceCount: number | null;
    duplicateWeakIndicators: Row[];
  };
  profitStats: {
    totals: {
      totalCandidates: number | null;
      approved: number | null;
      rejected: number | null;
      pendingReview: number | null;
      avgEstimatedProfit: number | null;
      avgMarginPct: number | null;
      avgRoiPct: number | null;
    };
    topCandidates: Row[];
  };
  listingStatus: {
    byStatus: Row[];
    duplicateSkipped: number | null;
    dryRunOk: number | null;
    recentPublishFailures: Row[];
  };
  workerHealth: {
    recentWorkerActivityAt: string | null;
    recentWorkerActivityCount: number;
    recentFailures: Row[];
    recentAuditEvents: Row[];
  };
  alerts: ControlPanelAlert[];
};

const PIPELINE_TABLES = [
  "trend_signals",
  "trend_candidates",
  "products_raw",
  "marketplace_prices",
  "matches",
  "active_matches",
  "profitable_candidates",
] as const;

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
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = '${table}'
    ) as exists
  `);
  return Boolean(rows[0]?.exists);
}

async function getTableColumns(table: string): Promise<string[]> {
  const rows = await runQuery(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = '${table}'
    order by ordinal_position
  `);
  return rows.map((r) => String(r.column_name));
}

function quoteIdent(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

async function getCount(table: string): Promise<CountEntry> {
  const exists = await tableExists(table);
  if (!exists) return { key: table, count: null, exists: false };
  const rows = await runQuery(`select count(*)::int as count from ${quoteIdent(table)}`);
  return { key: table, count: Number(rows[0]?.count ?? 0), exists: true };
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getDbHealth() {
  try {
    await runQuery("select 1 as ok");
    return { status: "ok" as const, detail: "Database query succeeded" };
  } catch (error) {
    return { status: "error" as const, detail: error instanceof Error ? error.message : "Database health failed" };
  }
}

async function getRedisHealth() {
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
      return { status: "unknown" as const, detail: "Redis client not exported" };
    }

    const pong = await (redisClient as { ping: () => Promise<string> }).ping();
    return { status: pong === "PONG" ? ("ok" as const) : ("unknown" as const), detail: String(pong) };
  } catch (error) {
    return { status: "error" as const, detail: error instanceof Error ? error.message : "Redis health failed" };
  }
}

async function getQueueHealth() {
  try {
    const queue = new Queue(JOBS_QUEUE_NAME, { connection: bullConnection, prefix: BULL_PREFIX });
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
    return {
      status: "ok" as const,
      detail: `Queue '${JOBS_QUEUE_NAME}' reachable`,
      counts,
    };
  } catch (error) {
    return {
      status: "error" as const,
      detail: error instanceof Error ? error.message : "Queue health failed",
      counts: {},
    };
  }
}

async function getPipelineOverview() {
  const counts = await Promise.all(PIPELINE_TABLES.map((t) => getCount(t)));

  const listingsByStatus = (await tableExists("listings"))
    ? await runQuery(`
      select status, count(*)::int as count
      from listings
      group by status
      order by count desc, status asc
    `)
    : [];

  const activeMatches = (await tableExists("matches"))
    ? Number(
        (
          await runQuery(`
            select count(*)::int as count
            from matches
            where upper(coalesce(status, '')) = 'ACTIVE'
          `)
        )[0]?.count ?? 0
      )
    : null;

  return { counts, listingsByStatus, activeMatches };
}

async function getMatchQuality() {
  if (!(await tableExists("matches"))) {
    return {
      confidenceDistribution: [],
      activeInactive: [],
      lowConfidenceCount: null,
      duplicateWeakIndicators: [],
    };
  }

  const columns = await getTableColumns("matches");
  const hasConfidence = columns.includes("confidence");

  const confidenceDistribution = hasConfidence
    ? await runQuery(`
      select
        case
          when confidence::numeric < 0.5 then 'low (<0.50)'
          when confidence::numeric < 0.8 then 'medium (0.50-0.79)'
          else 'high (>=0.80)'
        end as bucket,
        count(*)::int as count
      from matches
      group by 1
      order by count desc
    `)
    : [];

  const activeInactive = await runQuery(`
    select coalesce(status, 'UNKNOWN') as status, count(*)::int as count
    from matches
    group by coalesce(status, 'UNKNOWN')
    order by count desc
  `);

  const lowConfidenceCount = hasConfidence
    ? Number(
        (
          await runQuery(`
            select count(*)::int as count
            from matches
            where confidence::numeric < 0.6
          `)
        )[0]?.count ?? 0
      )
    : null;

  const duplicateWeakIndicators = hasConfidence
    ? await runQuery(`
      select
        supplier_key,
        supplier_product_id,
        count(*)::int as match_count,
        round(avg(confidence)::numeric, 4) as avg_confidence
      from matches
      group by supplier_key, supplier_product_id
      having count(*) > 1 or avg(confidence) < 0.6
      order by match_count desc, avg_confidence asc nulls last
      limit 12
    `)
    : [];

  return { confidenceDistribution, activeInactive, lowConfidenceCount, duplicateWeakIndicators };
}

async function getProfitStats() {
  if (!(await tableExists("profitable_candidates"))) {
    return {
      totals: {
        totalCandidates: null,
        approved: null,
        rejected: null,
        pendingReview: null,
        avgEstimatedProfit: null,
        avgMarginPct: null,
        avgRoiPct: null,
      },
      topCandidates: [],
    };
  }

  const columns = await getTableColumns("profitable_candidates");
  const hasEstimatedProfit = columns.includes("estimated_profit");
  const hasMarginPct = columns.includes("margin_pct");
  const hasRoiPct = columns.includes("roi_pct");

  const totalsRows = await runQuery(`
    select
      count(*)::int as total_candidates,
      count(*) filter (where decision_status = 'APPROVED')::int as approved,
      count(*) filter (where decision_status = 'REJECTED')::int as rejected,
      count(*) filter (where decision_status in ('PENDING', 'PENDING_REVIEW'))::int as pending_review,
      ${hasEstimatedProfit ? "round(avg(estimated_profit)::numeric, 2)" : "null"} as avg_estimated_profit,
      ${hasMarginPct ? "round(avg(margin_pct)::numeric, 2)" : "null"} as avg_margin_pct,
      ${hasRoiPct ? "round(avg(roi_pct)::numeric, 2)" : "null"} as avg_roi_pct
    from profitable_candidates
  `);

  const t = totalsRows[0] ?? {};
  const topCandidates = hasEstimatedProfit
    ? await runQuery(`
      select
        id,
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        decision_status,
        estimated_profit,
        margin_pct,
        roi_pct,
        reason
      from profitable_candidates
      order by estimated_profit desc nulls last
      limit 10
    `)
    : [];

  return {
    totals: {
      totalCandidates: num(t.total_candidates),
      approved: num(t.approved),
      rejected: num(t.rejected),
      pendingReview: num(t.pending_review),
      avgEstimatedProfit: num(t.avg_estimated_profit),
      avgMarginPct: num(t.avg_margin_pct),
      avgRoiPct: num(t.avg_roi_pct),
    },
    topCandidates,
  };
}

async function getListingStatus() {
  const listingTableExists = await tableExists("listings");
  const byStatus = listingTableExists
    ? await runQuery(`
      select status, count(*)::int as count
      from listings
      group by status
      order by count desc, status asc
    `)
    : [];

  const auditTableExists = await tableExists("audit_log");
  const duplicateSkipped = auditTableExists
    ? Number(
        (
          await runQuery(`
            select count(*)::int as count
            from audit_log
            where event_type = 'LISTING_PREVIEW_SKIPPED_DUPLICATE'
              and event_ts >= now() - interval '24 hours'
          `)
        )[0]?.count ?? 0
      )
    : null;

  const dryRunOk = auditTableExists
    ? Number(
        (
          await runQuery(`
            select count(*)::int as count
            from audit_log
            where lower(event_type) like '%dry%'
              and lower(event_type) like '%ok%'
              and event_ts >= now() - interval '24 hours'
          `)
        )[0]?.count ?? 0
      )
    : null;

  const recentPublishFailures = auditTableExists
    ? await runQuery(`
      select event_ts, event_type, entity_type, entity_id, details
      from audit_log
      where (
        event_type like 'LISTING_%FAILED%'
        or event_type like '%PUBLISH%FAILED%'
      )
      order by event_ts desc
      limit 10
    `)
    : [];

  return { byStatus, duplicateSkipped, dryRunOk, recentPublishFailures };
}

async function getWorkerHealth() {
  const auditTableExists = await tableExists("audit_log");
  const jobsTableExists = await tableExists("jobs");

  const recentWorkerActivity = auditTableExists
    ? await runQuery(`
      select
        max(event_ts) as last_event_ts,
        count(*)::int as activity_count
      from audit_log
      where actor_type in ('WORKER', 'SYSTEM')
        and event_ts >= now() - interval '60 minutes'
    `)
    : [];

  const recentFailures = jobsTableExists
    ? await runQuery(`
      select job_type, status, attempt, max_attempts, scheduled_ts, started_ts, finished_ts, last_error
      from jobs
      where status in ('FAILED', 'failed')
      order by coalesce(finished_ts, started_ts, scheduled_ts) desc nulls last
      limit 12
    `)
    : [];

  const recentAuditEvents = auditTableExists
    ? await runQuery(`
      select event_ts, actor_type, actor_id, entity_type, entity_id, event_type
      from audit_log
      order by event_ts desc
      limit 15
    `)
    : [];

  return {
    recentWorkerActivityAt: String(recentWorkerActivity[0]?.last_event_ts ?? "") || null,
    recentWorkerActivityCount: Number(recentWorkerActivity[0]?.activity_count ?? 0),
    recentFailures,
    recentAuditEvents,
  };
}

function buildAlerts(input: {
  pipelineOverview: ControlPanelData["pipelineOverview"];
  matchQuality: ControlPanelData["matchQuality"];
  profitStats: ControlPanelData["profitStats"];
  listingStatus: ControlPanelData["listingStatus"];
  workerHealth: ControlPanelData["workerHealth"];
  queue: { counts: Record<string, number> };
}): ControlPanelAlert[] {
  const alerts: ControlPanelAlert[] = [];

  const pricesCount = input.pipelineOverview.counts.find((c) => c.key === "marketplace_prices")?.count ?? null;
  if ((pricesCount ?? 0) === 0) {
    alerts.push({
      id: "no-prices",
      tone: "error",
      title: "No marketplace prices available",
      detail: "marketplace_prices has zero rows; scans may be stalled.",
    });
  }

  const matchesCount = input.pipelineOverview.counts.find((c) => c.key === "matches")?.count ?? 0;
  if (matchesCount > 0 && (input.matchQuality.lowConfidenceCount ?? 0) >= matchesCount) {
    alerts.push({
      id: "all-low-confidence",
      tone: "warning",
      title: "All matches are low confidence",
      detail: "Every tracked match is below the low-confidence threshold.",
    });
  }

  if ((input.profitStats.totals.totalCandidates ?? 0) === 0 && matchesCount > 0) {
    alerts.push({
      id: "no-profitable",
      tone: "warning",
      title: "No profitable candidates",
      detail: "Matches exist but no profitable_candidates were generated.",
    });
  }

  if (input.listingStatus.recentPublishFailures.length > 0) {
    alerts.push({
      id: "publish-failures",
      tone: "error",
      title: "Recent publish failures detected",
      detail: `${input.listingStatus.recentPublishFailures.length} publish-related failures found in recent audit events.`,
    });
  }

  if (!input.workerHealth.recentWorkerActivityAt) {
    alerts.push({
      id: "worker-inactive",
      tone: "warning",
      title: "No recent worker activity",
      detail: "No WORKER/SYSTEM audit activity in the last 60 minutes.",
    });
  }

  const queueFailed = input.queue.counts.failed ?? 0;
  if (queueFailed > 25) {
    alerts.push({
      id: "queue-failures",
      tone: "error",
      title: "Queue failures above threshold",
      detail: `BullMQ reports ${queueFailed} failed jobs.`,
    });
  }

  return alerts;
}

export async function getControlPanelData(): Promise<ControlPanelData> {
  const [dbHealth, redisHealth, queue, pipelineOverview, matchQuality, profitStats, listingStatus, workerHealth] =
    await Promise.all([
      getDbHealth(),
      getRedisHealth(),
      getQueueHealth(),
      getPipelineOverview(),
      getMatchQuality(),
      getProfitStats(),
      getListingStatus(),
      getWorkerHealth(),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    infrastructure: { db: dbHealth, redis: redisHealth, queue },
    pipelineOverview,
    matchQuality,
    profitStats,
    listingStatus,
    workerHealth,
    alerts: buildAlerts({
      pipelineOverview,
      matchQuality,
      profitStats,
      listingStatus,
      workerHealth,
      queue,
    }),
  };
}
