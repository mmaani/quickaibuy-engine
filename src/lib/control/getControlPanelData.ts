import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resolveBullPrefix, resolveJobsQueueName } from "@/lib/queueNamespace";
import { getPublishRateLimitState } from "@/lib/listings/publishRateLimiter";
import { getPriceGuardThresholds } from "@/lib/profit/priceGuardConfig";
import { getManualOverrideSnapshot } from "./manualOverrides";

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
    marketplaceSnapshotHealth: {
      freshSnapshots: number | null;
      staleSnapshots: number | null;
      thresholdHours: number;
      latestSnapshotTs: string | null;
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
  inventoryRisk: {
    listingsScanned: number | null;
    lowRiskFlags: number | null;
    manualReviewRisks: number | null;
    autoPausedListings: number | null;
    riskTypeBreakdown: {
      priceDriftHigh: number | null;
      supplierOutOfStock: number | null;
      snapshotTooOld: number | null;
      supplierShippingChanged: number | null;
      listingRemoved: number | null;
    };
    sourceWired: {
      listings: boolean;
      response: boolean;
      audit: boolean;
    };
  };
  publishPerformance: {
    activeListings: number | null;
    publishedToday: number | null;
    publishedThisWeek: number | null;
    publishAttempts: number | null;
    publishSuccesses: number | null;
    publishSuccessRatePct: number | null;
    blockedListings: number | null;
    publishFailureReasons: Array<{ reason: string; count: number; technicalDetail: string | null }>;
    sourceWired: {
      listings: boolean;
      audit: boolean;
      successRate: boolean;
      blockedListings: boolean;
      failureReasons: boolean;
    };
  };
  recoveryStates: {
    staleMarketplaceBlocks: number | null;
    supplierDriftBlocks: number | null;
    supplierAvailabilityManualReview: number | null;
    supplierAvailabilityBlocks: number | null;
    combinedBlocks: number | null;
    marketplaceRefreshPending: number | null;
    supplierRefreshPending: number | null;
    refreshJobsPending: number | null;
    reEvaluationNeeded: number | null;
    rePromotionReady: number | null;
    sourceWired: {
      staleMarketplaceBlocks: boolean;
      supplierDriftBlocks: boolean;
      supplierAvailabilityManualReview: boolean;
      supplierAvailabilityBlocks: boolean;
      combinedBlocks: boolean;
      marketplaceRefreshPending: boolean;
      supplierRefreshPending: boolean;
      refreshJobsPending: boolean;
      reEvaluationNeeded: boolean;
      rePromotionReady: boolean;
    };
    actionHints: Array<{
      id: string;
      label: string;
      technicalLabel: string;
      hint: string;
      severity: "critical" | "info";
    }>;
  };
  purchaseSafety: {
    notCheckedYet: number | null;
    checkedPass: number | null;
    checkedManualReview: number | null;
    blockedStaleSupplierData: number | null;
    blockedSupplierDrift: number | null;
    blockedEconomics: number | null;
    sourceWired: {
      orders: boolean;
      orderEvents: boolean;
      safetyPayload: boolean;
    };
    actionHints: Array<{
      id: string;
      label: string;
      technicalLabel: string;
      hint: string;
      severity: "critical" | "info";
    }>;
  };
  orderOperations: {
    totalOrders: number | null;
    purchaseSafetyPending: number | null;
    purchaseSafetyPassed: number | null;
    purchaseSafetyManualReview: number | null;
    purchaseSafetyBlocked: number | null;
    trackingPending: number | null;
    trackingSynced: number | null;
    sourceWired: {
      orders: boolean;
      purchaseSafety: boolean;
      tracking: boolean;
    };
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
  manualOverrides: {
    available: boolean;
    entries: Array<{
      key: string;
      enabled: boolean;
      note: string | null;
      changedBy: string | null;
      changedAt: string | null;
    }>;
    activeCount: number;
    emergencyReadOnly: boolean;
    limitations: string[];
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

function truncateText(value: string, limit = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1))}…`;
}

function humanizePublishFailureReason(raw: string | null): string {
  if (!raw) return "Unknown publish failure";
  const text = raw.trim();
  const upper = text.toUpperCase();

  if (upper.includes("DAILY CAP") || upper.includes("DAILY_CAP") || upper.includes("CAP EXHAUSTED")) {
    return "Daily cap prevented publish";
  }
  if (upper.includes("RATE LIMIT") || upper.includes("TOO MANY REQUESTS")) {
    return "Rate limit prevented publish";
  }
  if (upper.includes("STALE_MARKETPLACE")) {
    return "Market data too old";
  }
  if (upper.includes("STALE_SUPPLIER")) {
    return "Supplier data too old";
  }
  if (upper.includes("SUPPLIER_PRICE_DRIFT") || upper.includes("SUPPLIER_DRIFT")) {
    return "Supplier product changed";
  }
  if (
    upper.includes("VALIDATION") ||
    upper.includes("INVALID") ||
    upper.includes("PAYLOAD")
  ) {
    return "Listing payload failed validation";
  }
  if (
    upper.includes("EAI_AGAIN") ||
    upper.includes("ETIMEDOUT") ||
    upper.includes("ENOTFOUND") ||
    upper.includes("ECONNRESET") ||
    upper.includes("ECONNREFUSED") ||
    upper.includes("NETWORK")
  ) {
    return "Marketplace connection failed";
  }
  if (
    upper.includes("PUBLISHED_EXTERNAL_ID") ||
    upper.includes("EXTERNAL ID") ||
    upper.includes("EXTERNAL_ID")
  ) {
    return "Marketplace publish response invalid";
  }
  if (upper.includes("FAILED QUERY") || upper.includes("UPDATE LISTINGS SET STATUS = 'ACTIVE'")) {
    return "Database write failed during publish";
  }

  return "Publish failed (see technical detail)";
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
    const queueName = resolveJobsQueueName();
    const bullPrefix = resolveBullPrefix();
    const queue = new Queue(queueName, { connection: bullConnection, prefix: bullPrefix });
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
    return { status: "ok" as const, detail: `Queue '${queueName}' reachable`, counts };
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
    manualOverrideSnapshot,
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
    getManualOverrideSnapshot(),
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
  const marketplaceSnapshotThresholdHours = Math.max(
    1,
    Math.floor(priceGuardThresholds.maxMarketplaceSnapshotAgeHours)
  );

  const marketplaceSnapshotHealth = marketplacePricesExists && pricesHasSnapshotTs
    ? (
        await runQuery(`
          select
            count(*) filter (
              where lower(coalesce(marketplace_key, '')) = 'ebay'
                and snapshot_ts >= now() - interval '${marketplaceSnapshotThresholdHours} hours'
            )::int as fresh_snapshots,
            count(*) filter (
              where lower(coalesce(marketplace_key, '')) = 'ebay'
                and snapshot_ts < now() - interval '${marketplaceSnapshotThresholdHours} hours'
            )::int as stale_snapshots,
            max(snapshot_ts) filter (
              where lower(coalesce(marketplace_key, '')) = 'ebay'
            ) as latest_snapshot_ts
          from marketplace_prices
        `)
      )[0] ?? {}
    : {};

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

  const listingsHasPublishFinishedTs = listingsExists ? await columnExists("listings", "publish_finished_ts") : false;
  const listingsHasPublishStartedTs = listingsExists ? await columnExists("listings", "publish_started_ts") : false;
  const listingsHasLastPublishError = listingsExists ? await columnExists("listings", "last_publish_error") : false;
  const listingsHasUpdatedAt = listingsExists ? await columnExists("listings", "updated_at") : false;

  const listingThroughput = {
    previews: listingsExists ? countByStatus(listingStatuses, "PREVIEW") : null,
    readyToPublish: listingsExists ? countByStatus(listingStatuses, "READY_TO_PUBLISH") : null,
    active: listingsExists ? countByStatus(listingStatuses, "ACTIVE") : null,
    publishFailed: listingsExists ? countByStatus(listingStatuses, "PUBLISH_FAILED") : null,
    recentPublishAttempts24h: listingsExists && listingsHasPublishStartedTs
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from listings
              where publish_started_ts >= now() - interval '24 hours'
            `)
          )[0]?.count
        )
      : null,
    recentPublishSuccesses24h: listingsExists && listingsHasPublishFinishedTs
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from listings
              where status = 'ACTIVE'
                and publish_finished_ts >= now() - interval '24 hours'
            `)
          )[0]?.count
        )
      : null,
    recentPublishFailures24h: listingsExists && listingsHasUpdatedAt
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from listings
              where status = 'PUBLISH_FAILED'
                and updated_at >= now() - interval '24 hours'
            `)
          )[0]?.count
        )
      : null,
  };

  const listingsHasResponse = listingsExists ? await columnExists("listings", "response") : false;
  const inventoryRiskSummary =
    listingsExists && listingsHasResponse
      ? (
          await runQuery(`
            with risk_rows as (
              select
                upper(coalesce(l.status, '')) as listing_status,
                upper(coalesce((l.response::jsonb)->'inventoryRisk'->>'action', '')) as risk_action
              from listings l
              where lower(coalesce(l.marketplace_key, '')) = 'ebay'
                and jsonb_typeof(coalesce(l.response::jsonb, '{}'::jsonb)) = 'object'
                and jsonb_typeof(coalesce((l.response::jsonb)->'inventoryRisk', '{}'::jsonb)) = 'object'
            )
            select
              count(*) filter (where risk_action = 'FLAG')::int as low_risk_flags,
              count(*) filter (where risk_action = 'MANUAL_REVIEW')::int as manual_review_risks,
              count(*) filter (
                where risk_action = 'AUTO_PAUSE'
                  and listing_status = 'PAUSED'
              )::int as auto_paused_listings
            from risk_rows
          `)
        )[0] ?? {}
      : {};

  const inventoryRiskByType =
    listingsExists && listingsHasResponse
      ? (
          await runQuery(`
            with risk_signals as (
              select
                upper(coalesce(sig->>'code', '')) as risk_code
              from listings l
              left join lateral jsonb_array_elements(
                case
                  when jsonb_typeof((l.response::jsonb)->'inventoryRisk'->'signals') = 'array'
                    then (l.response::jsonb)->'inventoryRisk'->'signals'
                  else '[]'::jsonb
                end
              ) sig on true
              where lower(coalesce(l.marketplace_key, '')) = 'ebay'
                and jsonb_typeof(coalesce(l.response::jsonb, '{}'::jsonb)) = 'object'
                and jsonb_typeof(coalesce((l.response::jsonb)->'inventoryRisk', '{}'::jsonb)) = 'object'
            )
            select
              count(*) filter (where risk_code = 'PRICE_DRIFT_HIGH')::int as price_drift_high,
              count(*) filter (where risk_code = 'SUPPLIER_OUT_OF_STOCK')::int as supplier_out_of_stock,
              count(*) filter (where risk_code = 'SNAPSHOT_TOO_OLD')::int as snapshot_too_old,
              count(*) filter (where risk_code = 'SUPPLIER_SHIPPING_CHANGED')::int as supplier_shipping_changed,
              count(*) filter (where risk_code = 'LISTING_REMOVED')::int as listing_removed
            from risk_signals
          `)
        )[0] ?? {}
      : {};

  const latestInventoryRiskScan = auditExists
    ? (
        await runQuery(`
          select
            case
              when coalesce(details->>'activeListingsScanned', '') ~ '^[0-9]+$'
                then (details->>'activeListingsScanned')::int
              else null
            end as active_listings_scanned
          from audit_log
          where event_type = 'INVENTORY_RISK_SCAN_COMPLETED'
          order by event_ts desc
          limit 1
        `)
      )[0] ?? {}
    : {};

  const inventoryListingsScanned =
    toNum(latestInventoryRiskScan.active_listings_scanned) ?? listingThroughput.active;

  const publishSuccesses = listingThroughput.active;
  const publishFailuresTotal = listingThroughput.publishFailed;
  const activeListings = listingThroughput.active;
  const publishAttempts =
    publishSuccesses == null || publishFailuresTotal == null
      ? null
      : publishSuccesses + publishFailuresTotal;

  const publishSuccessRatePct =
    publishAttempts != null &&
    publishAttempts > 0 &&
    publishSuccesses != null
      ? Math.round((publishSuccesses / publishAttempts) * 10000) / 100
      : null;

  const publishedToday = listingsExists && listingsHasPublishFinishedTs
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from listings
            where status = 'ACTIVE'
              and publish_finished_ts >= date_trunc('day', now())
          `)
        )[0]?.count
      )
    : null;

  const publishedThisWeek = listingsExists && listingsHasPublishFinishedTs
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from listings
            where status = 'ACTIVE'
              and publish_finished_ts >= date_trunc('week', now())
          `)
        )[0]?.count
      )
    : null;

  const publishFailureReasons = listingsExists && listingsHasLastPublishError
    ? (() => {
        const grouped = new Map<string, { count: number; technicalDetail: string | null }>();
        return grouped;
      })()
    : null;

  if (publishFailureReasons) {
    const rows = await runQuery(`
      select
        coalesce(nullif(trim(last_publish_error), ''), 'UNKNOWN') as raw_reason,
        count(*)::int as count
      from listings
      where status = 'PUBLISH_FAILED'
      group by 1
      order by count desc, raw_reason asc
      limit 20
    `);
    for (const row of rows) {
      const rawReason = toStr(row.raw_reason) ?? "UNKNOWN";
      const humanReason = humanizePublishFailureReason(rawReason);
      const current = publishFailureReasons.get(humanReason) ?? { count: 0, technicalDetail: null };
      current.count += toNum(row.count) ?? 0;
      if (!current.technicalDetail && rawReason !== "UNKNOWN") {
        current.technicalDetail = truncateText(rawReason, 140);
      }
      publishFailureReasons.set(humanReason, current);
    }
  }

  const publishFailureReasonRows = publishFailureReasons
    ? Array.from(publishFailureReasons.entries())
        .map(([reason, entry]) => ({
          reason,
          count: entry.count,
          technicalDetail: entry.technicalDetail,
        }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
        .slice(0, 6)
    : [];

  const publishFailures = listingsExists && listingsHasLastPublishError
    ? (await runQuery(`
      select id, candidate_id, marketplace_key, status, updated_at, last_publish_error
      from listings
      where status = 'PUBLISH_FAILED'
      order by updated_at desc nulls last
      limit 15
    `)).map((row) => {
      const raw = toStr(row.last_publish_error);
      return {
        id: row.id,
        candidate_id: row.candidate_id,
        marketplace_key: row.marketplace_key,
        status: row.status,
        updated_at: row.updated_at,
        failure_reason: humanizePublishFailureReason(raw),
        technical_detail: raw ? truncateText(raw, 180) : null,
      };
    })
    : listingsExists
      ? await runQuery(`
        select id, candidate_id, marketplace_key, status, updated_at
        from listings
        where status = 'PUBLISH_FAILED'
        order by updated_at desc nulls last
        limit 15
      `)
      : [];

  const publishAttempts24h = listingThroughput.recentPublishAttempts24h;

  const blockedListings = listingsExists && profitableCandidatesExists
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from listings l
            inner join profitable_candidates pc on pc.id = l.candidate_id
            where lower(coalesce(l.marketplace_key, '')) = 'ebay'
              and upper(coalesce(l.status, '')) in ('PREVIEW', 'READY_TO_PUBLISH', 'PUBLISH_FAILED')
              and coalesce(pc.listing_eligible, false) = false
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
  const profitableCandidatesHasListingEligible = profitableCandidatesExists
    ? await columnExists("profitable_candidates", "listing_eligible")
    : false;
  const profitableCandidatesHasListingBlockReason = profitableCandidatesExists
    ? await columnExists("profitable_candidates", "listing_block_reason")
    : false;
  const jobsHasStatus = jobsExists ? await columnExists("jobs", "status") : false;
  const jobsHasJobType = jobsExists ? await columnExists("jobs", "job_type") : false;

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
  const orderEventsExists = await tableExists("order_events");
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

  const recoveryBlockFilter = `
    (
      upper(coalesce(pc.listing_block_reason, '')) LIKE '%STALE_MARKETPLACE%'
      OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%STALE_SUPPLIER%'
      OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%SUPPLIER_PRICE_DRIFT%'
      OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%SUPPLIER_DRIFT%'
    )
  `;

  const staleMarketplaceBlocks =
    profitableCandidatesExists &&
    profitableCandidatesHasListingEligible &&
    profitableCandidatesHasListingBlockReason
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from profitable_candidates pc
              where pc.listing_eligible = false
                and upper(coalesce(pc.listing_block_reason, '')) like '%STALE_MARKETPLACE%'
            `)
          )[0]?.count
        )
      : null;

  const supplierDriftBlocks =
    profitableCandidatesExists &&
    profitableCandidatesHasListingEligible &&
    profitableCandidatesHasListingBlockReason
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from profitable_candidates pc
              where pc.listing_eligible = false
                and (
                  upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_PRICE_DRIFT%'
                  or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_DRIFT%'
                  or upper(coalesce(pc.listing_block_reason, '')) like '%STALE_SUPPLIER%'
                )
            `)
          )[0]?.count
        )
      : null;

  const supplierAvailabilityManualReview =
    profitableCandidatesExists &&
    profitableCandidatesHasListingEligible &&
    profitableCandidatesHasListingBlockReason
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from profitable_candidates pc
              where pc.listing_eligible = false
                and (
                  upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_AVAILABILITY_UNKNOWN%'
                  or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_LOW_STOCK%'
                  or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_AVAILABILITY_LOW_CONFIDENCE%'
                )
            `)
          )[0]?.count
        )
      : null;

  const supplierAvailabilityBlocks =
    profitableCandidatesExists &&
    profitableCandidatesHasListingEligible &&
    profitableCandidatesHasListingBlockReason
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from profitable_candidates pc
              where pc.listing_eligible = false
                and upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_OUT_OF_STOCK%'
            `)
          )[0]?.count
        )
      : null;

  const combinedBlocks =
    profitableCandidatesExists &&
    profitableCandidatesHasListingEligible &&
    profitableCandidatesHasListingBlockReason
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from profitable_candidates pc
              where pc.listing_eligible = false
                and upper(coalesce(pc.listing_block_reason, '')) like '%STALE_MARKETPLACE%'
                and (
                  upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_PRICE_DRIFT%'
                  or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_DRIFT%'
                  or upper(coalesce(pc.listing_block_reason, '')) like '%STALE_SUPPLIER%'
                )
            `)
          )[0]?.count
        )
      : null;

  const marketplaceRefreshPending = jobsExists && jobsHasStatus && jobsHasJobType
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from jobs
            where upper(coalesce(status, '')) in ('QUEUED', 'RUNNING')
              and job_type = 'SCAN_MARKETPLACE_PRICE'
          `)
        )[0]?.count
      )
    : null;

  const supplierRefreshPending = jobsExists && jobsHasStatus && jobsHasJobType
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from jobs
            where upper(coalesce(status, '')) in ('QUEUED', 'RUNNING')
              and job_type = 'supplier:discover'
          `)
        )[0]?.count
      )
    : null;

  const refreshJobsPending = jobsExists && jobsHasStatus && jobsHasJobType
    ? (marketplaceRefreshPending ?? 0) + (supplierRefreshPending ?? 0)
    : null;

  const reEvaluationNeeded =
    profitableCandidatesExists &&
    profitableCandidatesHasListingEligible &&
    profitableCandidatesHasListingBlockReason &&
    pcHasDecisionStatus
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from profitable_candidates pc
              where pc.listing_eligible = false
                and (
                  ${recoveryBlockFilter}
                  or upper(coalesce(pc.decision_status, '')) = 'MANUAL_REVIEW'
                )
            `)
          )[0]?.count
        )
      : null;

  const rePromotionReady =
    profitableCandidatesExists &&
    profitableCandidatesHasListingEligible &&
    pcHasDecisionStatus &&
    listingsExists
      ? toNum(
          (
            await runQuery(`
              select count(*)::int as count
              from profitable_candidates pc
              inner join lateral (
                select l.id, l.status
                from listings l
                where l.candidate_id = pc.id
                  and lower(coalesce(l.marketplace_key, '')) = 'ebay'
                order by l.updated_at desc nulls last, l.created_at desc nulls last, l.id desc
                limit 1
              ) l on true
              where lower(coalesce(pc.marketplace_key, '')) = 'ebay'
                and upper(coalesce(pc.decision_status, '')) = 'APPROVED'
                and pc.listing_eligible = true
                and upper(coalesce(l.status, '')) = 'PREVIEW'
            `)
          )[0]?.count
        )
      : null;

  const recoveryActionHints: ControlPanelData["recoveryStates"]["actionHints"] = [];
  if ((staleMarketplaceBlocks ?? 0) > 0) {
    recoveryActionHints.push({
      id: "market-data-too-old",
      label: "Market data too old",
      technicalLabel: "STALE_MARKETPLACE_BLOCK",
      hint: "Refresh market data, then re-check the affected listings.",
      severity: "critical",
    });
  }
  if ((supplierDriftBlocks ?? 0) > 0) {
    recoveryActionHints.push({
      id: "supplier-product-changed",
      label: "Supplier product changed",
      technicalLabel: "SUPPLIER_DRIFT_BLOCK",
      hint: "Review supplier change in /admin/review before re-promotion.",
      severity: "critical",
    });
  }
  if ((supplierAvailabilityManualReview ?? 0) > 0) {
    recoveryActionHints.push({
      id: "supplier-availability-manual-review",
      label: "Supplier availability changed",
      technicalLabel: "SUPPLIER_AVAILABILITY_MANUAL_REVIEW",
      hint: "Re-check supplier stock certainty in /admin/review before publish.",
      severity: "critical",
    });
  }
  if ((supplierAvailabilityBlocks ?? 0) > 0) {
    recoveryActionHints.push({
      id: "supplier-availability-blocked",
      label: "Supplier out of stock",
      technicalLabel: "SUPPLIER_AVAILABILITY_BLOCK",
      hint: "Do not publish blocked items until supplier stock recovers.",
      severity: "critical",
    });
  }
  if ((combinedBlocks ?? 0) > 0) {
    recoveryActionHints.push({
      id: "combined-blocks",
      label: "Blocked for safety",
      technicalLabel: "COMBINED_STALE_AND_DRIFT_BLOCK",
      hint: "Clear both market freshness and supplier safety checks before re-promotion.",
      severity: "critical",
    });
  }
  if ((marketplaceRefreshPending ?? 0) > 0) {
    recoveryActionHints.push({
      id: "marketplace-refresh-pending",
      label: "Waiting for market refresh",
      technicalLabel: "MARKETPLACE_REFRESH_PENDING",
      hint: "Wait for market refresh jobs, then re-check blocked listings.",
      severity: "info",
    });
  }
  if ((supplierRefreshPending ?? 0) > 0) {
    recoveryActionHints.push({
      id: "supplier-refresh-pending",
      label: "Waiting for supplier refresh",
      technicalLabel: "SUPPLIER_REFRESH_PENDING",
      hint: "Wait for supplier refresh jobs, then re-check blocked listings.",
      severity: "info",
    });
  }
  if ((refreshJobsPending ?? 0) > 0) {
    recoveryActionHints.push({
      id: "waiting-for-refresh",
      label: "Waiting for refresh",
      technicalLabel: "REFRESH_JOBS_PENDING",
      hint: "Wait for refresh jobs to complete before re-checking.",
      severity: "info",
    });
  }
  if ((reEvaluationNeeded ?? 0) > 0) {
    recoveryActionHints.push({
      id: "needs-recheck",
      label: "Needs re-check",
      technicalLabel: "RE_EVALUATION_NEEDED",
      hint: "Use explicit re-evaluation in /admin/listings for blocked rows.",
      severity: "critical",
    });
  }
  if ((rePromotionReady ?? 0) > 0) {
    recoveryActionHints.push({
      id: "ready-for-repromotion",
      label: "Ready for re-promotion",
      technicalLabel: "REPROMOTION_READY",
      hint: "Promote from PREVIEW to READY_TO_PUBLISH when checks pass.",
      severity: "info",
    });
  }

  const purchaseSafetyStats = ordersExists && orderEventsExists
    ? (
        await runQuery(`
          with latest_checks as (
            select distinct on (oe.order_id)
              oe.order_id,
              coalesce(oe.details ->> 'status', '') as safety_status
            from order_events oe
            where oe.event_type = 'MANUAL_NOTE'
              and coalesce(oe.details ->> 'action', '') = 'PURCHASE_SAFETY_CHECK'
            order by oe.order_id, oe.event_ts desc nulls last, oe.id desc
          )
          select
            (select count(*)::int from orders where lower(coalesce(marketplace, '')) = 'ebay') as total_orders,
            count(*)::int as checked_orders,
            count(*) filter (where safety_status = 'READY_FOR_PURCHASE_REVIEW')::int as checked_pass,
            count(*) filter (where safety_status = 'MANUAL_REVIEW_REQUIRED')::int as checked_manual_review,
            count(*) filter (where safety_status = 'BLOCKED_STALE_DATA')::int as blocked_stale_supplier_data,
            count(*) filter (where safety_status = 'BLOCKED_SUPPLIER_DRIFT')::int as blocked_supplier_drift,
            count(*) filter (where safety_status = 'BLOCKED_ECONOMICS_OUT_OF_BOUNDS')::int as blocked_economics
          from latest_checks
        `)
      )[0] ?? {}
    : {};

  const totalOrdersForSafety = toNum(purchaseSafetyStats.total_orders);
  const checkedOrdersForSafety = toNum(purchaseSafetyStats.checked_orders) ?? 0;
  const purchaseSafetyNotCheckedYet =
    totalOrdersForSafety == null ? null : Math.max(0, totalOrdersForSafety - checkedOrdersForSafety);
  const purchaseSafetyCheckedPass = toNum(purchaseSafetyStats.checked_pass);
  const purchaseSafetyCheckedManualReview = toNum(purchaseSafetyStats.checked_manual_review);
  const purchaseSafetyBlockedStaleSupplierData = toNum(purchaseSafetyStats.blocked_stale_supplier_data);
  const purchaseSafetyBlockedSupplierDrift = toNum(purchaseSafetyStats.blocked_supplier_drift);
  const purchaseSafetyBlockedEconomics = toNum(purchaseSafetyStats.blocked_economics);
  const purchaseSafetyBlockedTotal =
    (purchaseSafetyBlockedStaleSupplierData ?? 0) +
    (purchaseSafetyBlockedSupplierDrift ?? 0) +
    (purchaseSafetyBlockedEconomics ?? 0);
  const purchaseSafetyPendingTotal =
    (purchaseSafetyNotCheckedYet ?? 0) +
    (purchaseSafetyCheckedManualReview ?? 0) +
    purchaseSafetyBlockedTotal;

  const purchaseSafetyHints: ControlPanelData["purchaseSafety"]["actionHints"] = [];
  if ((purchaseSafetyNotCheckedYet ?? 0) > 0) {
    purchaseSafetyHints.push({
      id: "purchase-safety-not-checked",
      label: "Purchase safety not checked",
      technicalLabel: "VALIDATION_NEEDED",
      hint: "Run purchase safety check before approving purchase.",
      severity: "critical",
    });
  }
  if ((purchaseSafetyCheckedManualReview ?? 0) > 0) {
    purchaseSafetyHints.push({
      id: "purchase-manual-review",
      label: "Purchase needs manual review",
      technicalLabel: "MANUAL_REVIEW_REQUIRED",
      hint: "Review safety reasons in /admin/orders before purchase approval.",
      severity: "critical",
    });
  }
  if ((purchaseSafetyBlockedStaleSupplierData ?? 0) > 0) {
    purchaseSafetyHints.push({
      id: "purchase-blocked-stale-supplier",
      label: "Blocked: stale supplier data",
      technicalLabel: "BLOCKED_STALE_DATA",
      hint: "Wait for fresh supplier data, then re-check purchase safety.",
      severity: "critical",
    });
  }
  if ((purchaseSafetyBlockedSupplierDrift ?? 0) > 0) {
    purchaseSafetyHints.push({
      id: "purchase-blocked-supplier-drift",
      label: "Blocked: supplier changed",
      technicalLabel: "BLOCKED_SUPPLIER_DRIFT",
      hint: "Review supplier change before approving purchase.",
      severity: "critical",
    });
  }
  if ((purchaseSafetyBlockedEconomics ?? 0) > 0) {
    purchaseSafetyHints.push({
      id: "purchase-blocked-economics",
      label: "Blocked: poor economics",
      technicalLabel: "BLOCKED_ECONOMICS_OUT_OF_BOUNDS",
      hint: "Do not approve purchase until economics are safe.",
      severity: "critical",
    });
  }
  if ((purchaseSafetyCheckedPass ?? 0) > 0) {
    purchaseSafetyHints.push({
      id: "purchase-safety-passed",
      label: "Purchase safety passed",
      technicalLabel: "READY_FOR_PURCHASE_REVIEW",
      hint: "Manual-assisted purchase is allowed after operator review.",
      severity: "info",
    });
  }

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

  if (manualOverrideSnapshot.entries.PAUSE_PUBLISHING.enabled) {
    publishingSafetyAlerts.push({
      id: "override-pause-publishing",
      tone: "warning",
      title: "Publishing is manually paused",
      detail: "Operator override is active: publish-related actions are blocked in admin control.",
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

  if ((toNum(marketplaceSnapshotHealth.stale_snapshots) ?? 0) > 0) {
    publishingSafetyAlerts.push({
      id: "stale-marketplace-snapshots",
      tone: "warning",
      title: "Stale marketplace snapshots",
      detail: `${toNum(marketplaceSnapshotHealth.stale_snapshots)} marketplace_prices rows are older than ${marketplaceSnapshotThresholdHours}h.`,
    });
  }

  if (manualOverrideSnapshot.entries.PAUSE_MARKETPLACE_SCAN.enabled) {
    operationalFreshnessAlerts.push({
      id: "override-pause-marketplace-scan",
      tone: "warning",
      title: "Marketplace scan is manually paused",
      detail: "Operator override is active: scan actions are blocked in admin control.",
    });
  }

  if (manualOverrideSnapshot.entries.PAUSE_ORDER_SYNC.enabled) {
    operationalFreshnessAlerts.push({
      id: "override-pause-order-sync",
      tone: "warning",
      title: "Order sync is manually paused",
      detail: "Operator override is active: order-sync actions should remain paused.",
    });
  }

  if (manualOverrideSnapshot.emergencyReadOnly) {
    publishingSafetyAlerts.push({
      id: "override-emergency-read-only",
      tone: "error",
      title: "Emergency read-only mode is active",
      detail: "State-changing admin actions are blocked until emergency mode is turned off.",
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
      marketplaceSnapshotHealth: {
        freshSnapshots: toNum(marketplaceSnapshotHealth.fresh_snapshots),
        staleSnapshots: toNum(marketplaceSnapshotHealth.stale_snapshots),
        thresholdHours: marketplaceSnapshotThresholdHours,
        latestSnapshotTs: toStr(marketplaceSnapshotHealth.latest_snapshot_ts),
        hasPartialData: !marketplacePricesExists || !pricesHasSnapshotTs,
      },
      publishRateLimit,
      staleCandidateCount: toNum(priceGuardSummary.stale_candidate_count),
      blockedCount: toNum(priceGuardSummary.blocked_count),
      manualReviewCount: toNum(priceGuardSummary.manual_review_count),
    },
    inventoryRisk: {
      listingsScanned: inventoryListingsScanned,
      lowRiskFlags: toNum(inventoryRiskSummary.low_risk_flags),
      manualReviewRisks: toNum(inventoryRiskSummary.manual_review_risks),
      autoPausedListings: toNum(inventoryRiskSummary.auto_paused_listings),
      riskTypeBreakdown: {
        priceDriftHigh: toNum(inventoryRiskByType.price_drift_high),
        supplierOutOfStock: toNum(inventoryRiskByType.supplier_out_of_stock),
        snapshotTooOld: toNum(inventoryRiskByType.snapshot_too_old),
        supplierShippingChanged: toNum(inventoryRiskByType.supplier_shipping_changed),
        listingRemoved: toNum(inventoryRiskByType.listing_removed),
      },
      sourceWired: {
        listings: listingsExists,
        response: listingsExists && listingsHasResponse,
        audit: auditExists,
      },
    },
    recoveryStates: {
      staleMarketplaceBlocks,
      supplierDriftBlocks,
      supplierAvailabilityManualReview,
      supplierAvailabilityBlocks,
      combinedBlocks,
      marketplaceRefreshPending,
      supplierRefreshPending,
      refreshJobsPending,
      reEvaluationNeeded,
      rePromotionReady,
      sourceWired: {
        staleMarketplaceBlocks:
          profitableCandidatesExists &&
          profitableCandidatesHasListingEligible &&
          profitableCandidatesHasListingBlockReason,
        supplierDriftBlocks:
          profitableCandidatesExists &&
          profitableCandidatesHasListingEligible &&
          profitableCandidatesHasListingBlockReason,
        supplierAvailabilityManualReview:
          profitableCandidatesExists &&
          profitableCandidatesHasListingEligible &&
          profitableCandidatesHasListingBlockReason,
        supplierAvailabilityBlocks:
          profitableCandidatesExists &&
          profitableCandidatesHasListingEligible &&
          profitableCandidatesHasListingBlockReason,
        combinedBlocks:
          profitableCandidatesExists &&
          profitableCandidatesHasListingEligible &&
          profitableCandidatesHasListingBlockReason,
        marketplaceRefreshPending: jobsExists && jobsHasStatus && jobsHasJobType,
        supplierRefreshPending: jobsExists && jobsHasStatus && jobsHasJobType,
        refreshJobsPending: jobsExists && jobsHasStatus && jobsHasJobType,
        reEvaluationNeeded:
          profitableCandidatesExists &&
          profitableCandidatesHasListingEligible &&
          profitableCandidatesHasListingBlockReason &&
          pcHasDecisionStatus,
        rePromotionReady:
          profitableCandidatesExists &&
          profitableCandidatesHasListingEligible &&
          pcHasDecisionStatus &&
          listingsExists,
      },
      actionHints: recoveryActionHints,
    },
    purchaseSafety: {
      notCheckedYet: purchaseSafetyNotCheckedYet,
      checkedPass: purchaseSafetyCheckedPass,
      checkedManualReview: purchaseSafetyCheckedManualReview,
      blockedStaleSupplierData: purchaseSafetyBlockedStaleSupplierData,
      blockedSupplierDrift: purchaseSafetyBlockedSupplierDrift,
      blockedEconomics: purchaseSafetyBlockedEconomics,
      sourceWired: {
        orders: ordersExists,
        orderEvents: orderEventsExists,
        safetyPayload: ordersExists && orderEventsExists,
      },
      actionHints: purchaseSafetyHints,
    },
    orderOperations: {
      totalOrders: ordersExists ? toNum(ordersSummary.total_orders) : null,
      purchaseSafetyPending: purchaseSafetyPendingTotal,
      purchaseSafetyPassed: purchaseSafetyCheckedPass,
      purchaseSafetyManualReview: purchaseSafetyCheckedManualReview,
      purchaseSafetyBlocked: purchaseSafetyBlockedTotal,
      trackingPending: ordersExists ? toNum(ordersSummary.tracking_pending) : null,
      trackingSynced: ordersExists ? toNum(ordersSummary.tracking_synced) : null,
      sourceWired: {
        orders: ordersExists,
        purchaseSafety: ordersExists && orderEventsExists,
        tracking: ordersExists,
      },
    },
    publishPerformance: {
      activeListings,
      publishedToday,
      publishedThisWeek,
      publishAttempts,
      publishSuccesses,
      publishSuccessRatePct,
      blockedListings,
      publishFailureReasons: publishFailureReasonRows,
      sourceWired: {
        listings: listingsExists,
        audit: false,
        successRate: listingsExists,
        blockedListings: listingsExists && profitableCandidatesExists,
        failureReasons: listingsExists && listingsHasLastPublishError,
      },
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
    manualOverrides: {
      available: manualOverrideSnapshot.available,
      entries: Object.values(manualOverrideSnapshot.entries),
      activeCount: manualOverrideSnapshot.activeCount,
      emergencyReadOnly: manualOverrideSnapshot.emergencyReadOnly,
      limitations: manualOverrideSnapshot.limitations,
    },
    alerts,
  };
}
