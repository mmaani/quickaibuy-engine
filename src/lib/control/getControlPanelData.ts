import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { BULL_PREFIX, JOBS_QUEUE_NAME } from "@/lib/jobNames";
import { getPublishRateLimitState } from "@/lib/listings/publishRateLimiter";
import { getPriceGuardThresholds } from "@/lib/profit/priceGuardConfig";

type Row = Record<string, unknown>;
type HealthState = "ok" | "error" | "unknown";

export type ControlPanelData = {
  generatedAt: string;
  health: {
    db: { status: HealthState; detail?: string };
    redis: { status: HealthState; detail?: string };
    queue: { status: HealthState; detail?: string; counts: Record<string, number> };
  };
  pipelineOverview: {
    counts: Array<{ table: string; count: number | null; exists: boolean; optional?: boolean }>;
    listingStatuses: Row[];
  };
  supplierDiscoveryHealth: {
    bySupplier: Row[];
    freshnessBySupplier: Row[];
  };
  matchQuality: {
    totalMatches: number | null;
    activeMatches: number | null;
    confidenceDistribution: Row[];
    lowConfidenceCount: number | null;
    weakOrDuplicateIndicators: Row[];
  };
  marketplaceScanHealth: {
    totalEbayPrices: number | null;
    latestEbayScanTs: string | null;
    recentEbayPrices24h: number | null;
  };
  profitEngineStats: {
    totalCandidates: number | null;
    approved: number | null;
    rejected: number | null;
    pendingReview: number | null;
    avgEstimatedProfit: number | null;
    avgMarginPct: number | null;
    avgRoiPct: number | null;
    topCandidates: Row[];
  };
  reviewQueue: {
    pendingReview: number | null;
    approved: number | null;
    rejected: number | null;
    oldestPendingCalcTs: string | null;
  };
  publishingSafety: {
    priceGuardSummary: {
      totalCandidates: number | null;
      staleCandidateCount: number | null;
      blockedCount: number | null;
      manualReviewCount: number | null;
      staleThresholdHours: number;
      hasPartialData: boolean;
    };
    publishRateLimit: {
      allowed: boolean;
      blockingWindow: "15m" | "1h" | "1d" | "none";
      counts: {
        attempts15m: number;
        attempts1h: number;
        attempts1d: number;
      };
      limits: {
        limit15m: number;
        limit1h: number;
        limit1d: number;
      };
      retryHint: string | null;
    };
    staleCandidateCount: number | null;
    blockedCount: number | null;
    manualReviewCount: number | null;
  };
  listingThroughput: {
    previews: number | null;
    readyToPublish: number | null;
    active: number | null;
    publishFailed: number | null;
    recentPublishAttempts24h: number | null;
    recentPublishSuccesses24h: number | null;
    recentPublishFailures24h: number | null;
  };
  listingLifecycle: {
    statusCounts: Row[];
    readyToPublishBacklog: number | null;
    publishAttempts24h: number | null;
    publishFailures: Row[];
      dailyCap: {
        capDate: string | null;
        capLimit: number | null;
        capUsed: number | null;
        capRemaining: number | null;
        exhausted: boolean;
        exists: boolean;
      };
      publishRateLimit: {
        allowed: boolean;
        blockingWindow: "15m" | "1h" | "1d" | "none";
        counts: {
          attempts15m: number;
          attempts1h: number;
          attempts1d: number;
        };
        limits: {
          limit15m: number;
          limit1h: number;
          limit1d: number;
        };
        retryHint: string | null;
      };
    };
  workerQueueHealth: {
    recentWorkerRuns: Row[];
    recentWorkerFailures: Row[];
    recentJobs: Row[];
    recentJobFailures: Row[];
    recentAuditEvents: Row[];
    recentWorkerActivityTs: string | null;
    recentSuccessCount24h: number | null;
    recentFailureCount24h: number | null;
  };
  futureOrders: {
    supported: boolean;
    totalOrders: number | null;
    purchaseReviewPending: number | null;
    trackingPending: number | null;
    trackingSynced: number | null;
    partialReason: string | null;
  };
  prioritizedAlerts: {
    publishingSafety: Array<{ id: string; tone: "warning" | "error"; title: string; detail: string }>;
    operationalFreshness: Array<{ id: string; tone: "warning" | "error"; title: string; detail: string }>;
    futureOrders: Array<{ id: string; tone: "warning" | "error"; title: string; detail: string }>;
  };
  alerts: Array<{ id: string; tone: "warning" | "error"; title: string; detail: string }>;
};

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

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await runQuery(`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = '${table}'
        and column_name = '${column}'
    ) as exists
  `);
  return Boolean(rows[0]?.exists);
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function countByStatus(rows: Row[], status: string): number {
  const hit = rows.find((row) => String(row.status ?? "").toUpperCase() === status.toUpperCase());
  return toNum(hit?.count) ?? 0;
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
    const [{ Queue }, { bullConnection }] = await Promise.all([
      import("bullmq"),
      import("@/lib/bull"),
    ]);
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
    return { status: "ok" as const, detail: `Queue '${JOBS_QUEUE_NAME}' reachable`, counts };
  } catch (error) {
    return {
      status: "error" as const,
      detail: error instanceof Error ? error.message : "Queue health failed",
      counts: {},
    };
  }
}

function isRuntimeQueueProbeEnabled(): boolean {
  const raw = String(process.env.ENABLE_RUNTIME_QUEUE_HEALTH_PROBE ?? "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

async function getCount(table: string, optional = false) {
  const exists = await tableExists(table);
  if (!exists) return { table, count: null, exists, optional };
  const rows = await runQuery(`select count(*)::int as count from "${table}"`);
  return { table, count: toNum(rows[0]?.count), exists, optional };
}

export async function getControlPanelData(): Promise<ControlPanelData> {
  const runtimeQueueProbeEnabled = isRuntimeQueueProbeEnabled();
  const [
    dbHealth,
    redisHealth,
    queueHealth,
    productsRawExists,
    marketplacePricesExists,
    matchesExists,
    profitableCandidatesExists,
    listingsExists,
    listingDailyCapsExists,
    workerRunsExists,
    jobsExists,
    auditExists,
  ] = await Promise.all([
    getDbHealth(),
    runtimeQueueProbeEnabled
      ? getRedisHealth()
      : Promise.resolve({ status: "unknown" as const, detail: "Runtime probe disabled; using DB-backed worker/job truth." }),
    runtimeQueueProbeEnabled
      ? getQueueHealth()
      : Promise.resolve({
          status: "unknown" as const,
          detail: "Runtime queue probe disabled; prefer worker_runs/jobs durability.",
          counts: {},
        }),
    tableExists("products_raw"),
    tableExists("marketplace_prices"),
    tableExists("matches"),
    tableExists("profitable_candidates"),
    tableExists("listings"),
    tableExists("listing_daily_caps"),
    tableExists("worker_runs"),
    tableExists("jobs"),
    tableExists("audit_log"),
  ]);

  const pipelineCounts = await Promise.all([
    getCount("products_raw"),
    getCount("marketplace_prices"),
    getCount("matches"),
    getCount("profitable_candidates"),
    getCount("listings"),
    getCount("trend_signals", true),
    getCount("trend_candidates", true),
  ]);

  const listingStatuses = listingsExists
    ? await runQuery(`
      select status, count(*)::int as count
      from listings
      group by status
      order by count desc, status asc
    `)
    : [];

  const supplierDiscoveryHealthBySupplier = productsRawExists
    ? await runQuery(`
      select supplier_key, count(*)::int as count
      from products_raw
      group by supplier_key
      order by count desc, supplier_key asc
    `)
    : [];

  const productsRawHasSnapshotTs = productsRawExists ? await columnExists("products_raw", "snapshot_ts") : false;
  const supplierDiscoveryFreshness = productsRawHasSnapshotTs
    ? await runQuery(`
      select
        supplier_key,
        max(snapshot_ts) as latest_snapshot_ts,
        count(*) filter (where snapshot_ts >= now() - interval '24 hours')::int as rows_24h
      from products_raw
      group by supplier_key
      order by latest_snapshot_ts desc nulls last
    `)
    : [];

  const matchesHasStatus = matchesExists ? await columnExists("matches", "status") : false;
  const matchesHasConfidence = matchesExists ? await columnExists("matches", "confidence") : false;

  const totalMatches = matchesExists
    ? toNum((await runQuery(`select count(*)::int as count from matches`))[0]?.count)
    : null;

  const activeMatches = matchesHasStatus
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from matches
            where upper(coalesce(status, '')) = 'ACTIVE'
          `)
        )[0]?.count
      )
    : null;

  const confidenceDistribution = matchesHasConfidence
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

  const lowConfidenceCount = matchesHasConfidence
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from matches
            where confidence::numeric < 0.6
          `)
        )[0]?.count
      )
    : null;

  const weakOrDuplicateIndicators = matchesHasConfidence
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
      limit 15
    `)
    : [];

  const pricesHasMarketplaceKey = marketplacePricesExists
    ? await columnExists("marketplace_prices", "marketplace_key")
    : false;
  const pricesHasSnapshotTs = marketplacePricesExists
    ? await columnExists("marketplace_prices", "snapshot_ts")
    : false;

  const ebayWhere = pricesHasMarketplaceKey ? "where lower(coalesce(marketplace_key, '')) = 'ebay'" : "";

  const totalEbayPrices = marketplacePricesExists
    ? toNum((await runQuery(`select count(*)::int as count from marketplace_prices ${ebayWhere}`))[0]?.count)
    : null;

  const latestEbayScanTs = marketplacePricesExists && pricesHasSnapshotTs
    ? toStr((await runQuery(`select max(snapshot_ts) as latest_scan_ts from marketplace_prices ${ebayWhere}`))[0]?.latest_scan_ts)
    : null;

  const recentEbayPrices24h = marketplacePricesExists && pricesHasSnapshotTs
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from marketplace_prices
            ${pricesHasMarketplaceKey ? "where lower(coalesce(marketplace_key, '')) = 'ebay' and" : "where"}
            snapshot_ts >= now() - interval '24 hours'
          `)
        )[0]?.count
      )
    : null;

  const pcHasDecisionStatus = profitableCandidatesExists
    ? await columnExists("profitable_candidates", "decision_status")
    : false;

  const profitStats = profitableCandidatesExists
    ? (
        await runQuery(`
          select
            count(*)::int as total_candidates,
            count(*) filter (where decision_status = 'APPROVED')::int as approved,
            count(*) filter (where decision_status = 'REJECTED')::int as rejected,
            count(*) filter (where upper(coalesce(decision_status, '')) in ('PENDING', 'PENDING_REVIEW', 'RECHECK'))::int as pending_review,
            round(avg(estimated_profit)::numeric, 2) as avg_estimated_profit,
            round(avg(margin_pct)::numeric, 2) as avg_margin_pct,
            round(avg(roi_pct)::numeric, 2) as avg_roi_pct
          from profitable_candidates
        `)
      )[0] ?? {}
    : {};

  const topCandidates = profitableCandidatesExists
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

  const oldestPendingCalcTs = profitableCandidatesExists && pcHasDecisionStatus
    ? toStr(
        (
          await runQuery(`
            select min(calc_ts) as oldest_pending
            from profitable_candidates
            where upper(coalesce(decision_status, '')) in ('PENDING', 'PENDING_REVIEW', 'RECHECK')
          `)
        )[0]?.oldest_pending
      )
    : null;

  const priceGuardThresholds = getPriceGuardThresholds();
  const staleThresholdHours = Math.max(
    priceGuardThresholds.maxMarketplaceSnapshotAgeHours,
    priceGuardThresholds.maxSupplierSnapshotAgeHours
  );

  const priceGuardSummary = profitableCandidatesExists
    ? (
        await runQuery(`
          select
            count(*)::int as total_candidates,
            count(*) filter (
              where calc_ts < now() - interval '${staleThresholdHours} hours'
            )::int as stale_candidate_count,
            count(*) filter (
              where coalesce(listing_eligible, false) = false
                or upper(coalesce(decision_status, '')) = 'REJECTED'
            )::int as blocked_count,
            count(*) filter (
              where upper(coalesce(decision_status, '')) in ('PENDING', 'PENDING_REVIEW', 'MANUAL_REVIEW', 'RECHECK')
            )::int as manual_review_count
          from profitable_candidates
        `)
      )[0] ?? {}
    : {};

  const readyToPublishBacklog = listingsExists
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from listings
            where status = 'READY_TO_PUBLISH'
          `)
        )[0]?.count
      )
    : null;

  const listingThroughput = {
    previews: listingsExists ? countByStatus(listingStatuses, "PREVIEW") : null,
    readyToPublish: listingsExists ? countByStatus(listingStatuses, "READY_TO_PUBLISH") : null,
    active: listingsExists ? countByStatus(listingStatuses, "ACTIVE") : null,
    publishFailed: listingsExists ? countByStatus(listingStatuses, "PUBLISH_FAILED") : null,
    recentPublishAttempts24h: auditExists
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from audit_log
              where event_ts >= now() - interval '24 hours'
                and event_type in ('LISTING_PUBLISH_STARTED')
            `)
          )[0]?.count
        )
      : null,
    recentPublishSuccesses24h: auditExists
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from audit_log
              where event_ts >= now() - interval '24 hours'
                and event_type in ('LISTING_PUBLISH_COMPLETED')
            `)
          )[0]?.count
        )
      : null,
    recentPublishFailures24h: auditExists
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from audit_log
              where event_ts >= now() - interval '24 hours'
                and event_type in ('LISTING_PUBLISH_FAILED')
            `)
          )[0]?.count
        )
      : null,
  };

  const publishFailures = listingsExists
    ? await runQuery(`
      select id, candidate_id, marketplace_key, status, updated_at
      from listings
      where status = 'PUBLISH_FAILED'
      order by updated_at desc nulls last
      limit 15
    `)
    : [];

  const publishAttempts24h = auditExists
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from audit_log
            where event_ts >= now() - interval '24 hours'
              and (
                event_type like '%PUBLISH%'
                or event_type = 'LISTING_READY_TO_PUBLISH'
              )
          `)
        )[0]?.count
      )
    : null;

  const dailyCapRow = listingDailyCapsExists
    ? (
        await runQuery(`
          select cap_date, cap_limit::int as cap_limit, cap_used::int as cap_used
          from listing_daily_caps
          where lower(coalesce(marketplace_key, '')) = 'ebay'
          order by cap_date desc
          limit 1
        `)
      )[0] ?? null
    : null;

  const capLimit = toNum(dailyCapRow?.cap_limit);
  const capUsed = toNum(dailyCapRow?.cap_used);
  const capRemaining = capLimit == null || capUsed == null ? null : Math.max(0, capLimit - capUsed);
  const publishRateLimit = await getPublishRateLimitState("ebay");

  const workerRunsHasStartedAt = workerRunsExists ? await columnExists("worker_runs", "started_at") : false;
  const workerRunsHasFinishedAt = workerRunsExists ? await columnExists("worker_runs", "finished_at") : false;
  const workerRunsHasUpdatedAt = workerRunsExists ? await columnExists("worker_runs", "updated_at") : false;
  const workerRunsHasCreatedAt = workerRunsExists ? await columnExists("worker_runs", "created_at") : false;

  const workerRunsOrderExpr = workerRunsHasStartedAt || workerRunsHasFinishedAt
    ? "coalesce(finished_at, started_at)"
    : workerRunsHasUpdatedAt || workerRunsHasCreatedAt
      ? "coalesce(updated_at, created_at)"
      : "id";

  const recentWorkerRuns = workerRunsExists
    ? await runQuery(`select * from worker_runs order by ${workerRunsOrderExpr} desc nulls last limit 15`)
    : [];

  const recentWorkerFailures = workerRunsExists
    ? await runQuery(`
      select *
      from worker_runs
      where upper(coalesce(status, '')) = 'FAILED'
      order by ${workerRunsOrderExpr} desc nulls last
      limit 10
    `)
    : [];

  const recentWorkerActivityTs = workerRunsExists
    ? toStr((await runQuery(`select max(${workerRunsOrderExpr}) as ts from worker_runs`))[0]?.ts)
    : null;

  const recentWorkerSuccessCount24h = workerRunsExists
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from worker_runs
            where upper(coalesce(status, '')) = 'SUCCEEDED'
              and ${workerRunsOrderExpr} >= now() - interval '24 hours'
          `)
        )[0]?.count
      )
    : null;

  const recentWorkerFailureCount24h = workerRunsExists
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from worker_runs
            where upper(coalesce(status, '')) = 'FAILED'
              and ${workerRunsOrderExpr} >= now() - interval '24 hours'
          `)
        )[0]?.count
      )
    : null;

  const recentJobs = jobsExists
    ? await runQuery(`
      select job_type, status, attempt, max_attempts, scheduled_ts, started_ts, finished_ts
      from jobs
      order by coalesce(finished_ts, started_ts, scheduled_ts) desc nulls last
      limit 20
    `)
    : [];

  const recentJobFailures = jobsExists
    ? await runQuery(`
      select job_type, status, attempt, max_attempts, finished_ts, last_error
      from jobs
      where lower(coalesce(status, '')) = 'failed'
      order by coalesce(finished_ts, started_ts, scheduled_ts) desc nulls last
      limit 10
    `)
    : [];

  const recentAuditEvents = auditExists
    ? await runQuery(`
      select event_ts, actor_type, actor_id, entity_type, entity_id, event_type
      from audit_log
      order by event_ts desc
      limit 15
    `)
    : [];

  const ordersExists = await tableExists("orders");
  const ordersSummary = ordersExists
    ? (
        await runQuery(`
          select
            count(*)::int as total_orders,
            count(*) filter (
              where upper(coalesce(status, '')) in ('MANUAL_REVIEW', 'NEW_ORDER', 'READY_FOR_PURCHASE_REVIEW')
            )::int as purchase_review_pending,
            count(*) filter (
              where upper(coalesce(status, '')) in ('TRACKING_PENDING', 'TRACKING_RECEIVED')
            )::int as tracking_pending,
            count(*) filter (
              where upper(coalesce(status, '')) = 'TRACKING_SYNCED'
            )::int as tracking_synced
          from orders
        `)
      )[0] ?? {}
    : {};

  const publishingSafetyAlerts: ControlPanelData["alerts"] = [];
  const operationalFreshnessAlerts: ControlPanelData["alerts"] = [];
  const futureOrdersAlerts: ControlPanelData["alerts"] = [];

  if (!publishRateLimit.allowed) {
    publishingSafetyAlerts.push({
      id: "publish-rate-limit-reached",
      tone: "warning",
      title: "Publish rate limit reached",
      detail: `Blocking window: ${publishRateLimit.blockingWindow}. ${publishRateLimit.retryHint ?? "Retry after current window cools down."}`,
    });
  }

  if (listingDailyCapsExists && capRemaining === 0) {
    publishingSafetyAlerts.push({
      id: "daily-cap-exhausted",
      tone: "warning",
      title: "Daily publish cap exhausted",
      detail: "listing_daily_caps shows no remaining publish capacity for eBay.",
    });
  }

  if (publishFailures.length > 0) {
    publishingSafetyAlerts.push({
      id: "publish-failed-exists",
      tone: "error",
      title: "Publish failures detected",
      detail: `${publishFailures.length} listings are currently in PUBLISH_FAILED status.`,
    });
  }

  if ((toNum(priceGuardSummary.stale_candidate_count) ?? 0) > 0) {
    publishingSafetyAlerts.push({
      id: "stale-profit-candidates",
      tone: "warning",
      title: "Stale candidate economics",
      detail: `${toNum(priceGuardSummary.stale_candidate_count)} profitable_candidates rows are older than ${staleThresholdHours}h.`,
    });
  }

  if ((recentEbayPrices24h ?? 0) === 0) {
    operationalFreshnessAlerts.push({
      id: "no-recent-ebay-prices",
      tone: "error",
      title: "Stale marketplace data",
      detail: "No marketplace_prices rows for eBay in the last 24h.",
    });
  }

  const latestSupplierSnapshotTs = toStr(supplierDiscoveryFreshness[0]?.latest_snapshot_ts);
  if (!latestSupplierSnapshotTs) {
    operationalFreshnessAlerts.push({
      id: "no-supplier-snapshots",
      tone: "warning",
      title: "Stale supplier data",
      detail: "Supplier snapshot freshness is unavailable.",
    });
  } else {
    const ageHours = (Date.now() - new Date(latestSupplierSnapshotTs).getTime()) / (1000 * 60 * 60);
    if (Number.isFinite(ageHours) && ageHours > priceGuardThresholds.maxSupplierSnapshotAgeHours) {
      operationalFreshnessAlerts.push({
        id: "supplier-data-stale-threshold",
        tone: "warning",
        title: "Stale supplier data",
        detail: `Latest supplier snapshot is ${Math.round(ageHours)}h old (> ${priceGuardThresholds.maxSupplierSnapshotAgeHours}h threshold).`,
      });
    }
  }

  if ((totalMatches ?? 0) > 0 && (lowConfidenceCount ?? 0) >= (totalMatches ?? 0)) {
    operationalFreshnessAlerts.push({
      id: "all-matches-low-confidence",
      tone: "warning",
      title: "All matches are low confidence",
      detail: "Every current match is below confidence threshold 0.60.",
    });
  }

  if ((toNum(profitStats.total_candidates) ?? 0) === 0 && (totalMatches ?? 0) > 0) {
    operationalFreshnessAlerts.push({
      id: "no-profitable-candidates",
      tone: "warning",
      title: "No profitable candidates",
      detail: "Matches exist but profitable_candidates count is zero.",
    });
  }

  if (!recentWorkerActivityTs) {
    operationalFreshnessAlerts.push({
      id: "no-worker-activity",
      tone: "warning",
      title: "Worker stopped or inactive",
      detail: "No recent worker_runs activity detected.",
    });
  } else {
    const workerAgeMinutes = (Date.now() - new Date(recentWorkerActivityTs).getTime()) / (1000 * 60);
    if (Number.isFinite(workerAgeMinutes) && workerAgeMinutes > 30) {
      operationalFreshnessAlerts.push({
        id: "worker-activity-stale",
        tone: "warning",
        title: "Worker activity stale",
        detail: `Most recent worker activity is ${Math.round(workerAgeMinutes)} minutes old.`,
      });
    }
  }

  const approvedWithoutPreview = profitableCandidatesExists && listingsExists
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from profitable_candidates pc
            where lower(coalesce(pc.marketplace_key, '')) = 'ebay'
              and pc.decision_status = 'APPROVED'
              and not exists (
                select 1
                from listings l
                where l.candidate_id = pc.id
                  and lower(coalesce(l.marketplace_key, '')) = 'ebay'
                  and l.status in ('PREVIEW', 'READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE', 'PUBLISH_FAILED', 'PAUSED', 'ENDED')
              )
          `)
        )[0]?.count
      )
    : null;

  if ((approvedWithoutPreview ?? 0) > 0) {
    operationalFreshnessAlerts.push({
      id: "approved-without-preview",
      tone: "warning",
      title: "Approved candidates without preview",
      detail: `${approvedWithoutPreview} approved eBay candidates do not yet have listing lifecycle rows.`,
    });
  }

  if (!ordersExists) {
    futureOrdersAlerts.push({
      id: "orders-placeholder-partial",
      tone: "warning",
      title: "Future order automation data is partial",
      detail: "orders table is unavailable in this environment; showing placeholder state only.",
    });
  } else {
    futureOrdersAlerts.push({
      id: "orders-placeholder-ready",
      tone: "warning",
      title: "Future order issues placeholder",
      detail: "Order sync/purchase/tracking automation is staged; monitor counts before enabling broad execution.",
    });
  }

  const alerts: ControlPanelData["alerts"] = [
    ...publishingSafetyAlerts,
    ...operationalFreshnessAlerts,
    ...futureOrdersAlerts,
  ];

  return {
    generatedAt: new Date().toISOString(),
    health: {
      db: dbHealth,
      redis: redisHealth,
      queue: queueHealth,
    },
    pipelineOverview: {
      counts: pipelineCounts,
      listingStatuses,
    },
    supplierDiscoveryHealth: {
      bySupplier: supplierDiscoveryHealthBySupplier,
      freshnessBySupplier: supplierDiscoveryFreshness,
    },
    matchQuality: {
      totalMatches,
      activeMatches,
      confidenceDistribution,
      lowConfidenceCount,
      weakOrDuplicateIndicators,
    },
    marketplaceScanHealth: {
      totalEbayPrices,
      latestEbayScanTs,
      recentEbayPrices24h,
    },
    profitEngineStats: {
      totalCandidates: toNum(profitStats.total_candidates),
      approved: toNum(profitStats.approved),
      rejected: toNum(profitStats.rejected),
      pendingReview: toNum(profitStats.pending_review),
      avgEstimatedProfit: toNum(profitStats.avg_estimated_profit),
      avgMarginPct: toNum(profitStats.avg_margin_pct),
      avgRoiPct: toNum(profitStats.avg_roi_pct),
      topCandidates,
    },
    reviewQueue: {
      pendingReview: toNum(profitStats.pending_review),
      approved: toNum(profitStats.approved),
      rejected: toNum(profitStats.rejected),
      oldestPendingCalcTs,
    },
    publishingSafety: {
      priceGuardSummary: {
        totalCandidates: toNum(priceGuardSummary.total_candidates),
        staleCandidateCount: toNum(priceGuardSummary.stale_candidate_count),
        blockedCount: toNum(priceGuardSummary.blocked_count),
        manualReviewCount: toNum(priceGuardSummary.manual_review_count),
        staleThresholdHours,
        hasPartialData: !profitableCandidatesExists,
      },
      publishRateLimit,
      staleCandidateCount: toNum(priceGuardSummary.stale_candidate_count),
      blockedCount: toNum(priceGuardSummary.blocked_count),
      manualReviewCount: toNum(priceGuardSummary.manual_review_count),
    },
    listingThroughput,
    listingLifecycle: {
      statusCounts: listingStatuses,
      readyToPublishBacklog,
      publishAttempts24h,
      publishFailures,
      dailyCap: {
        capDate: toStr(dailyCapRow?.cap_date),
        capLimit,
        capUsed,
        capRemaining,
        exhausted: capRemaining === 0,
        exists: listingDailyCapsExists,
      },
      publishRateLimit,
    },
    workerQueueHealth: {
      recentWorkerRuns,
      recentWorkerFailures,
      recentJobs,
      recentJobFailures,
      recentAuditEvents,
      recentWorkerActivityTs,
      recentSuccessCount24h: recentWorkerSuccessCount24h,
      recentFailureCount24h: recentWorkerFailureCount24h,
    },
    futureOrders: {
      supported: ordersExists,
      totalOrders: ordersExists ? toNum(ordersSummary.total_orders) : null,
      purchaseReviewPending: ordersExists ? toNum(ordersSummary.purchase_review_pending) : null,
      trackingPending: ordersExists ? toNum(ordersSummary.tracking_pending) : null,
      trackingSynced: ordersExists ? toNum(ordersSummary.tracking_synced) : null,
      partialReason: ordersExists ? null : "orders table unavailable in this environment",
    },
    prioritizedAlerts: {
      publishingSafety: publishingSafetyAlerts,
      operationalFreshness: operationalFreshnessAlerts,
      futureOrders: futureOrdersAlerts,
    },
    alerts,
  };
}
