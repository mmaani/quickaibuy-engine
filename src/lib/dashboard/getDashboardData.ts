import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobsQueue } from "@/lib/bull";
import { JOB_NAMES } from "@/lib/jobNames";
import {
  buildDashboardAlertHref,
  deriveCoverageState,
  deriveFreshnessState,
  deriveHealthStatus,
  deriveRenderState,
  deriveSeverity,
  getReadOnlyRefreshDescription,
    type DashboardAlert,
  type DashboardFieldLineage,
  type DashboardMetricState,
} from "@/lib/dashboard/status";
import { getPriceGuardThresholds } from "@/lib/profit/priceGuardConfig";
import { PRODUCT_PIPELINE_MATCH_PREFERRED_MIN } from "@/lib/products/pipelinePolicy";
import { getCjProofBlockingReason, getCjProofStateSummary, readCjProofStateFromRawPayload } from "@/lib/suppliers/cj";
import { getCjRuntimeDiagnostics } from "@/lib/suppliers/cj/settings";

type Row = Record<string, unknown>;
type HealthState = "ok" | "error" | "unknown";
type QueueScheduleEntry = { name?: string; id?: string | null; key?: string; every?: number | null; next?: number | null };
type QueryFailure = { key: string; source: string; message: string };

export type StageStatus = {
  key: string;
  label: string;
  state: DashboardMetricState;
  freshnessState: DashboardMetricState;
  healthStatus: DashboardMetricState;
  coverageState: ReturnType<typeof deriveCoverageState>;
  severity: ReturnType<typeof deriveSeverity>;
  renderState: ReturnType<typeof deriveRenderState>;
  thresholdHours: number;
  lastDataTs: string | null;
  lastSuccessfulRunTs: string | null;
  totalRows: number | null;
  freshRows: number | null;
  staleRows: number | null;
  latestFailedRunTs?: string | null;
  scheduleActive?: boolean;
  queryFailed: boolean;
  dominantBlocker?: string;
  actionableHref: string;
  detail: string;
};

export type PipelineMetric = {
  key: string;
  label: string;
  totalRows: number | null;
  freshRows: number | null;
  staleRows: number | null;
  freshnessWindow: string;
  scope: string;
};

export type DashboardData = {
  generatedAt: string;
  cjProofState: {
    overall: string;
    auth: string;
    freight: string;
    orderCreate: string;
    orderDetail: string;
    tracking: string;
    blockingReason: string | null;
    blockedCandidates: number | null;
  };
  cjRuntime: {
    runtimeTruthStatus: string;
    sandbox: boolean | null;
    qpsLimit: number | null;
    quotaLimit: number | null;
    quotaRemaining: number | null;
    shopsCount: number | null;
    lastSuccessfulSettingsRefreshAt: string | null;
    portalWarningPolicyNote: string;
  };
  infrastructure: {
    db: { status: HealthState; detail?: string };
    redis: { status: HealthState; detail?: string };
    environment: {
      nodeEnv: string;
      vercelEnv: string;
    };
  };
  refreshBehavior: ReturnType<typeof getReadOnlyRefreshDescription>;
  headline: {
    actionableFreshCandidates: number;
    approvedFreshCandidates: number;
    manualReviewDueToStale: number;
    staleMarketplaceSnapshots: number;
    criticalIssues: number;
  };
  stages: StageStatus[];
  pipelineMetrics: PipelineMetric[];
  trend: {
    totalSignals: number;
    recentSignals24h: number;
    manualSeedSignals: number;
    latestSignalTs: string | null;
    latestSuccessfulRunTs: string | null;
    recentSignals: Row[];
    recentCandidates: Row[];
  };
  supplier: {
    totalRows: number;
    freshRows: number;
    staleRows: number;
    latestSnapshotTs: string | null;
    latestSuccessfulRunTs: string | null;
    bySupplier: Row[];
  };
  marketplace: {
    totalEbayRows: number;
    freshEbayRows: number;
    staleEbayRows: number;
    latestSnapshotTs: string | null;
    latestSuccessfulRunTs: string | null;
  };
  matching: {
    totalMatches: number;
    freshMatches24h: number;
    lowConfidenceCount: number;
    averageConfidence: number | null;
    latestMatchTs: string | null;
    latestSuccessfulRunTs: string | null;
    recentMatches: Row[];
  };
  profitability: {
    totalCandidates: number;
    approved: number;
    manualReview: number;
    rejected: number;
    pending: number;
    actionableFresh: number;
    approvedFresh: number;
    manualReviewDueToStale: number;
    blockedByStaleSnapshot: number;
    blockedByLowConfidence: number;
    blockedByAvailability: number;
    blockedByPolicyOrManualReview: number;
    latestCalcTs: string | null;
    latestSuccessfulRunTs: string | null;
    statusBreakdown: Row[];
    blockBreakdown: Row[];
    topOpportunities: Row[];
  };
  listingReadiness: {
    readyToPublish: number;
    preview: number;
    active: number;
    publishFailed: number;
    latestListingTs: string | null;
  };
  leadPipeline: {
    total: number;
    newLeads: number;
    contacted: number;
    qualified: number;
    latestLeadTs: string | null;
    recentLeads: Row[];
  };
  diagnostics: {
    recentJobs: Row[];
    recentWorkerRuns: Row[];
    recentAuditEvents: Row[];
  };
  queryFailures: QueryFailure[];
  fieldLineage: DashboardFieldLineage[];
  adminLinks: Array<{ label: string; href: string; note: string }>;
  alerts: DashboardAlert[];
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

async function readOnlyQuery<T>(
  queryFailures: QueryFailure[],
  key: string,
  source: string,
  loader: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    queryFailures.push({
      key,
      source,
      message: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

function toNum(value: unknown): number {

  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toNullableNum(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toStr(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlStringList(values: string[]): string {
  return values.map(quoteLiteral).join(", ");
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await runQuery(`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${quoteLiteral(table)}
    ) as exists
  `);
  return Boolean(rows[0]?.exists);
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
      return { status: "unknown", detail: "Redis client export not found" };
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

async function getLatestSuccessfulJobTs(jobTypes: string[]): Promise<string | null> {
  if (!(await tableExists("worker_runs")) || jobTypes.length === 0) return null;
  const rows = await runQuery(`
    select max(coalesce(finished_at, started_at)) as ts
    from worker_runs
    where upper(coalesce(status, '')) = 'SUCCEEDED'
      and worker = 'jobs.worker'
      and job_name in (${sqlStringList(jobTypes)})
  `);
  return toStr(rows[0]?.ts);
}

async function getLatestFailedJobTs(jobTypes: string[]): Promise<string | null> {
  if (!(await tableExists("worker_runs")) || jobTypes.length === 0) return null;
  const rows = await runQuery(`
    select max(coalesce(finished_at, started_at)) as ts
    from worker_runs
    where upper(coalesce(status, '')) = 'FAILED'
      and worker = 'jobs.worker'
      and job_name in (${sqlStringList(jobTypes)})
  `);
  return toStr(rows[0]?.ts);
}

function buildStageStatus(input: {
  key: string;
  label: string;
  thresholdHours: number;
  lastDataTs: string | null;
  lastSuccessfulRunTs: string | null;
  totalRows: number | null;
  freshRows: number | null;
  staleRows: number | null;
  latestFailedRunTs?: string | null;
  scheduleActive?: boolean;
  queryFailed?: boolean;
  actionableHref: string;
  detailFresh: string;
  detailStale: string;
  detailUnknown: string;
  detailZero?: string;
  detailFailure?: string;
}): StageStatus {
  const freshnessState = deriveFreshnessState({
    totalRows: input.totalRows,
    freshRows: input.freshRows,
    staleRows: input.staleRows,
    lastDataTs: input.lastDataTs,
    lastSuccessfulRunTs: input.lastSuccessfulRunTs,
    latestFailedRunTs: input.latestFailedRunTs,
    scheduleActive: input.scheduleActive,
    queryFailed: input.queryFailed,
  });
  const healthStatus = deriveHealthStatus({
    totalRows: input.totalRows,
    freshRows: input.freshRows,
    staleRows: input.staleRows,
    lastDataTs: input.lastDataTs,
    lastSuccessfulRunTs: input.lastSuccessfulRunTs,
    latestFailedRunTs: input.latestFailedRunTs,
    scheduleActive: input.scheduleActive,
    queryFailed: input.queryFailed,
  });
  const renderState = deriveRenderState(healthStatus, { queryFailed: input.queryFailed });

  let detail = input.detailFresh;
  if (healthStatus === "TOTAL_FAILURE") detail = input.detailFailure ?? input.detailUnknown;
  else if (healthStatus === "UNKNOWN") detail = input.detailUnknown;
  else if (healthStatus === "ZERO_VALID") detail = input.detailZero ?? "No canonical rows currently satisfy this metric.";
  else if (healthStatus === "STALE" || healthStatus === "PARTIAL_FAILURE" || healthStatus === "FRESH_DEGRADED") detail = input.detailStale;

  return {
    key: input.key,
    label: input.label,
    state: healthStatus,
    freshnessState,
    healthStatus,
    coverageState: deriveCoverageState({
      totalRows: input.totalRows,
      freshRows: input.freshRows,
      queryFailed: input.queryFailed,
    }),
    severity: deriveSeverity(healthStatus),
    renderState,
    thresholdHours: input.thresholdHours,
    lastDataTs: input.lastDataTs,
    lastSuccessfulRunTs: input.lastSuccessfulRunTs,
    totalRows: input.totalRows,
    freshRows: input.freshRows,
    staleRows: input.staleRows,
    latestFailedRunTs: input.latestFailedRunTs,
    scheduleActive: input.scheduleActive,
    queryFailed: Boolean(input.queryFailed),
    actionableHref: input.actionableHref,
    detail,
  };
}
export async function getDashboardData(): Promise<DashboardData> {
  const thresholds = getPriceGuardThresholds();
  const trendWindowHours = 24;
  const supplierWindowHours = Math.max(1, thresholds.maxSupplierSnapshotAgeHours);
  const marketplaceWindowHours = Math.max(1, thresholds.maxMarketplaceSnapshotAgeHours);
  const matchWindowHours = 24;
  const profitabilityWindowHours = Math.max(supplierWindowHours, marketplaceWindowHours);

  const queryFailures: QueryFailure[] = [];

  const [
    dbHealth,
    redisHealth,
    trendSummaryRow,
    recentSignals,
    recentTrendCandidates,
    trendCandidatesSummaryRow,
    supplierSummaryRow,
    supplierBySupplier,
    marketplaceSummaryRow,
    matchingSummaryRow,
    recentMatches,
    profitabilitySummaryRow,
    profitabilityStatusBreakdown,
    profitabilityBlockBreakdown,
    topOpportunities,
    listingsSummaryRow,
    leadSummaryRow,
    recentLeads,
    recentJobs,
    recentWorkerRuns,
    recentAuditEvents,
    trendJobTs,
    supplierJobTs,
    marketplaceJobTs,
    matchJobTs,
    profitJobTs,
    trendFailedJobTs,
    supplierFailedJobTs,
    marketplaceFailedJobTs,
    matchFailedJobTs,
    profitFailedJobTs,
    scheduleVisibility,
    cjProofPayloadRows,
    cjProofBlockedCandidateRows,
    cjRuntime,
  ] = await Promise.all([
    getDbHealth().catch((error) => ({
      status: "error" as const,
      detail: error instanceof Error ? error.message : "Database health check failed",
    })),
    getRedisHealth().catch((error) => ({
      status: "error" as const,
      detail: error instanceof Error ? error.message : "Redis health check failed",
    })),
    readOnlyQuery(queryFailures, "trend_summary", "trend_signals", () =>
      runQuery(`
      select
        count(*)::int as total_signals,
        count(*) filter (where captured_ts >= now() - interval '${trendWindowHours} hours')::int as fresh_signals,
        count(*) filter (
          where coalesce((raw_payload ->> 'seed')::boolean, false) = true
             or lower(coalesce(source, '')) = 'manual'
        )::int as manual_seed_signals,
        max(captured_ts) as latest_signal_ts
      from trend_signals
    `).then((rows) => rows[0] ?? {}), {}),
    readOnlyQuery(queryFailures, "trend_recent_signals", "trend_signals", () =>
      runQuery(`
      select
        id,
        source,
        signal_type,
        signal_value,
        region,
        score,
        captured_ts
      from trend_signals
      order by captured_ts desc nulls last, id desc
      limit 8
    `), []),
    readOnlyQuery(queryFailures, "trend_recent_candidates", "trend_candidates", () =>
      runQuery(`
      select
        tc.id,
        tc.candidate_value,
        tc.status,
        tc.priority_score,
        tc.created_ts,
        ts.signal_value as source_signal
      from trend_candidates tc
      left join trend_signals ts on ts.id = tc.trend_signal_id
      order by tc.created_ts desc nulls last, tc.id desc
      limit 8
    `), []),
    readOnlyQuery(queryFailures, "trend_candidates_summary", "trend_candidates", () =>
      runQuery(`
      select
        count(*)::int as total_rows,
        count(*) filter (where created_ts >= now() - interval '${trendWindowHours} hours')::int as fresh_rows,
        count(*) filter (where created_ts < now() - interval '${trendWindowHours} hours')::int as stale_rows
      from trend_candidates
    `).then((rows) => rows[0] ?? {}), {}),
    readOnlyQuery(queryFailures, "supplier_summary", "products_raw", () =>
      runQuery(`
      select
        count(*)::int as total_rows,
        count(*) filter (where snapshot_ts >= now() - interval '${supplierWindowHours} hours')::int as fresh_rows,
        count(*) filter (where snapshot_ts < now() - interval '${supplierWindowHours} hours')::int as stale_rows,
        max(snapshot_ts) as latest_snapshot_ts
      from products_raw
    `).then((rows) => rows[0] ?? {}), {}),
    readOnlyQuery(queryFailures, "supplier_by_supplier", "products_raw", () =>
      runQuery(`
      select
        case
          when lower(trim(coalesce(supplier_key, ''))) in ('cj', 'cj dropshipping', 'cjdropshipping') then 'cjdropshipping'
          else lower(trim(coalesce(supplier_key, '')))
        end as supplier_key,
        count(*)::int as total_rows,
        count(*) filter (where snapshot_ts >= now() - interval '${supplierWindowHours} hours')::int as fresh_rows,
        count(*) filter (where snapshot_ts < now() - interval '${supplierWindowHours} hours')::int as stale_rows,
        max(snapshot_ts) as latest_snapshot_ts
      from products_raw
      group by 1
      order by latest_snapshot_ts desc nulls last, supplier_key asc
      limit 12
    `), []),
    readOnlyQuery(queryFailures, "marketplace_summary", "marketplace_prices", () =>
      runQuery(`
      select
        count(*) filter (where lower(coalesce(marketplace_key, '')) = 'ebay')::int as total_ebay_rows,
        count(*) filter (
          where lower(coalesce(marketplace_key, '')) = 'ebay'
            and snapshot_ts >= now() - interval '${marketplaceWindowHours} hours'
        )::int as fresh_ebay_rows,
        count(*) filter (
          where lower(coalesce(marketplace_key, '')) = 'ebay'
            and snapshot_ts < now() - interval '${marketplaceWindowHours} hours'
        )::int as stale_ebay_rows,
        max(snapshot_ts) filter (
          where lower(coalesce(marketplace_key, '')) = 'ebay'
        ) as latest_snapshot_ts
      from marketplace_prices
    `).then((rows) => rows[0] ?? {}), {}),
    readOnlyQuery(queryFailures, "matching_summary", "matches", () =>
      runQuery(`
      select
        count(*) filter (
          where lower(coalesce(marketplace_key, '')) = 'ebay'
            and upper(coalesce(status, '')) = 'ACTIVE'
        )::int as total_matches,
        count(*) filter (
          where lower(coalesce(marketplace_key, '')) = 'ebay'
            and upper(coalesce(status, '')) = 'ACTIVE'
            and last_seen_ts >= now() - interval '${matchWindowHours} hours'
        )::int as fresh_matches,
        count(*) filter (
          where lower(coalesce(marketplace_key, '')) = 'ebay'
            and upper(coalesce(status, '')) = 'ACTIVE'
            and confidence < ${PRODUCT_PIPELINE_MATCH_PREFERRED_MIN}
        )::int as low_confidence_count,
        round(avg(confidence) filter (
          where lower(coalesce(marketplace_key, '')) = 'ebay'
            and upper(coalesce(status, '')) = 'ACTIVE'
        )::numeric, 4) as average_confidence,
        max(last_seen_ts) filter (
          where lower(coalesce(marketplace_key, '')) = 'ebay'
            and upper(coalesce(status, '')) = 'ACTIVE'
        ) as latest_match_ts
      from matches
    `).then((rows) => rows[0] ?? {}), {}),
    readOnlyQuery(queryFailures, "matching_recent", "matches", () =>
      runQuery(`
      select
        supplier_key,
        supplier_product_id,
        marketplace_listing_id,
        confidence,
        match_type,
        last_seen_ts
      from matches
      where lower(coalesce(marketplace_key, '')) = 'ebay'
        and upper(coalesce(status, '')) = 'ACTIVE'
      order by last_seen_ts desc nulls last, id desc
      limit 8
    `), []),
    readOnlyQuery(queryFailures, "profitability_summary", "profitable_candidates", () =>
      runQuery(`
      with candidate_truth as (
        select
          pc.id,
          pc.supplier_key,
          pc.supplier_product_id,
          pc.marketplace_key,
          pc.marketplace_listing_id,
          pc.calc_ts,
          upper(coalesce(pc.decision_status, 'UNKNOWN')) as decision_status,
          coalesce(pc.listing_eligible, false) as listing_eligible,
          pc.listing_block_reason,
          pc.reason,
          pc.estimated_profit,
          pc.margin_pct,
          pc.roi_pct,
          exists (
            select 1
            from listings l
            where l.candidate_id = pc.id
              and upper(coalesce(l.status, '')) = 'ACTIVE'
          ) as has_active_listing,
          ps.snapshot_ts as supplier_snapshot_ts,
          mp.snapshot_ts as marketplace_snapshot_ts,
          case
            when ps.snapshot_ts is null or mp.snapshot_ts is null then false
            when ps.snapshot_ts < now() - interval '${supplierWindowHours} hours' then false
            when mp.snapshot_ts < now() - interval '${marketplaceWindowHours} hours' then false
            when pc.calc_ts < now() - interval '${profitabilityWindowHours} hours' then false
            else true
          end as is_fresh,
          case
            when upper(coalesce(pc.listing_block_reason, '')) like '%STALE_MARKETPLACE%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%STALE_SUPPLIER%'
              or mp.snapshot_ts < now() - interval '${marketplaceWindowHours} hours'
              or ps.snapshot_ts < now() - interval '${supplierWindowHours} hours'
            then 'stale_snapshot'
            when upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_OUT_OF_STOCK%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_LOW_STOCK%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%AVAILABILITY_NOT_CONFIRMED%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SHIPPING_SIGNAL_%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SOURCE_CHALLENGE_PAGE%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SOURCE_PROVIDER_BLOCK%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_BLOCKED%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_AVAILABILITY%'
            then 'availability'
            when coalesce(nullif(pc.estimated_fees ->> 'matchConfidence', ''), '0')::numeric < ${PRODUCT_PIPELINE_MATCH_PREFERRED_MIN}
            then 'low_confidence'
            when exists (
              select 1
              from listings l
              where l.candidate_id = pc.id
                and upper(coalesce(l.status, '')) = 'ACTIVE'
            )
            then 'already_live'
            when upper(coalesce(pc.decision_status, '')) = 'MANUAL_REVIEW'
              or upper(coalesce(pc.reason, '')) like '%PIPELINE MANUAL REVIEW%'
              or coalesce(pc.listing_eligible, false) = false
            then 'policy_or_manual_review'
            else 'actionable'
          end as blocker_category
        from profitable_candidates pc
        left join products_raw ps on ps.id = pc.supplier_snapshot_id
        left join marketplace_prices mp on mp.id = pc.market_price_snapshot_id
        where lower(coalesce(pc.marketplace_key, '')) = 'ebay'
      )
      select
        count(*)::int as total_candidates,
        count(*) filter (where decision_status = 'APPROVED')::int as approved,
        count(*) filter (where decision_status = 'MANUAL_REVIEW')::int as manual_review,
        count(*) filter (where decision_status = 'REJECTED')::int as rejected,
        count(*) filter (where decision_status in ('PENDING', 'PENDING_REVIEW', 'RECHECK'))::int as pending,
        count(*) filter (where is_fresh)::int as fresh_candidates,
        count(*) filter (where is_fresh and listing_eligible and decision_status = 'APPROVED')::int as actionable_fresh,
        count(*) filter (where is_fresh and decision_status = 'APPROVED')::int as approved_fresh,
        count(*) filter (where is_fresh and has_active_listing)::int as fresh_live,
        count(*) filter (where decision_status = 'MANUAL_REVIEW' and blocker_category = 'stale_snapshot')::int as manual_review_due_to_stale,
        count(*) filter (where blocker_category = 'stale_snapshot')::int as blocked_by_stale_snapshot,
        count(*) filter (where blocker_category = 'low_confidence')::int as blocked_by_low_confidence,
        count(*) filter (where blocker_category = 'availability')::int as blocked_by_availability,
        count(*) filter (where blocker_category = 'already_live')::int as blocked_by_already_live,
        count(*) filter (where blocker_category = 'policy_or_manual_review')::int as blocked_by_policy_or_manual_review,
        max(calc_ts) as latest_calc_ts
      from candidate_truth
    `).then((rows) => rows[0] ?? {}), {}),
    readOnlyQuery(queryFailures, "profitability_status_breakdown", "profitable_candidates", () =>
      runQuery(`
      select
        upper(coalesce(decision_status, 'UNKNOWN')) as decision_status,
        count(*)::int as count
      from profitable_candidates
      where lower(coalesce(marketplace_key, '')) = 'ebay'
      group by upper(coalesce(decision_status, 'UNKNOWN'))
      order by count desc, decision_status asc
    `), []),
    readOnlyQuery(queryFailures, "profitability_block_breakdown", "profitable_candidates", () =>
      runQuery(`
      with candidate_truth as (
        select
          case
            when upper(coalesce(pc.listing_block_reason, '')) like '%STALE_MARKETPLACE%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%STALE_SUPPLIER%'
              or mp.snapshot_ts < now() - interval '${marketplaceWindowHours} hours'
              or ps.snapshot_ts < now() - interval '${supplierWindowHours} hours'
            then 'stale_snapshot'
            when upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_OUT_OF_STOCK%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_LOW_STOCK%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%AVAILABILITY_NOT_CONFIRMED%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SHIPPING_SIGNAL_%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SOURCE_CHALLENGE_PAGE%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SOURCE_PROVIDER_BLOCK%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_BLOCKED%'
              or upper(coalesce(pc.listing_block_reason, '')) like '%SUPPLIER_AVAILABILITY%'
            then 'availability'
            when coalesce(nullif(pc.estimated_fees ->> 'matchConfidence', ''), '0')::numeric < ${PRODUCT_PIPELINE_MATCH_PREFERRED_MIN}
            then 'low_confidence'
            when upper(coalesce(pc.decision_status, '')) = 'MANUAL_REVIEW'
              or upper(coalesce(pc.reason, '')) like '%PIPELINE MANUAL REVIEW%'
              or coalesce(pc.listing_eligible, false) = false
            then 'policy_or_manual_review'
            else 'actionable'
          end as blocker_category
        from profitable_candidates pc
        left join products_raw ps on ps.id = pc.supplier_snapshot_id
        left join marketplace_prices mp on mp.id = pc.market_price_snapshot_id
        where lower(coalesce(pc.marketplace_key, '')) = 'ebay'
      )
      select
        blocker_category,
        count(*)::int as count
      from candidate_truth
      group by blocker_category
      order by count desc, blocker_category asc
    `), []),
    readOnlyQuery(queryFailures, "profitability_top_opportunities", "profitable_candidates", () =>
      runQuery(`
      with candidate_truth as (
        select
          pc.id,
          pc.supplier_key,
          pc.supplier_product_id,
          pc.marketplace_listing_id,
          pc.decision_status,
          pc.listing_eligible,
          pc.listing_block_reason,
          pc.reason,
          round(pc.estimated_profit::numeric, 2) as estimated_profit,
          round(pc.margin_pct::numeric, 2) as margin_pct,
          round(pc.roi_pct::numeric, 2) as roi_pct,
          round(coalesce(nullif(pc.estimated_fees ->> 'matchConfidence', ''), '0')::numeric, 4) as match_confidence,
          ps.snapshot_ts as supplier_snapshot_ts,
          mp.snapshot_ts as marketplace_snapshot_ts,
          round(extract(epoch from (now() - mp.snapshot_ts)) / 3600.0, 2) as marketplace_snapshot_age_hours,
          round(extract(epoch from (now() - ps.snapshot_ts)) / 3600.0, 2) as supplier_snapshot_age_hours,
          case
            when ps.snapshot_ts is null or mp.snapshot_ts is null then 'unknown'
            when ps.snapshot_ts < now() - interval '${supplierWindowHours} hours'
              or mp.snapshot_ts < now() - interval '${marketplaceWindowHours} hours'
              or pc.calc_ts < now() - interval '${profitabilityWindowHours} hours'
            then 'stale'
            else 'fresh'
          end as freshness_status,
          case
            when upper(coalesce(pc.decision_status, '')) = 'APPROVED'
              and coalesce(pc.listing_eligible, false) = true
              and ps.snapshot_ts >= now() - interval '${supplierWindowHours} hours'
              and mp.snapshot_ts >= now() - interval '${marketplaceWindowHours} hours'
              and pc.calc_ts >= now() - interval '${profitabilityWindowHours} hours'
            then 'actionable'
            when upper(coalesce(pc.decision_status, '')) = 'APPROVED'
            then 'approved_but_stale_or_blocked'
            when upper(coalesce(pc.decision_status, '')) = 'MANUAL_REVIEW'
            then 'manual_review'
            else lower(coalesce(pc.decision_status, 'unknown'))
          end as actionability_status
        from profitable_candidates pc
        left join products_raw ps on ps.id = pc.supplier_snapshot_id
        left join marketplace_prices mp on mp.id = pc.market_price_snapshot_id
        where lower(coalesce(pc.marketplace_key, '')) = 'ebay'
      )
      select
        id,
        supplier_key,
        supplier_product_id,
        marketplace_listing_id,
        estimated_profit,
        margin_pct,
        roi_pct,
        match_confidence,
        decision_status,
        actionability_status,
        freshness_status,
        marketplace_snapshot_age_hours,
        supplier_snapshot_age_hours,
        coalesce(listing_block_reason, reason, '') as blocking_reason
      from candidate_truth
      order by
        case actionability_status when 'actionable' then 0 when 'approved_but_stale_or_blocked' then 1 when 'manual_review' then 2 else 3 end,
        estimated_profit desc nulls last,
        id desc
      limit 10
    `), []),
    readOnlyQuery(queryFailures, "listings_summary", "listings", () =>
      runQuery(`
      select
        count(*) filter (where status = 'READY_TO_PUBLISH')::int as ready_to_publish,
        count(*) filter (where status = 'PREVIEW')::int as preview,
        count(*) filter (where status = 'ACTIVE')::int as active,
        count(*) filter (where status = 'PUBLISH_FAILED')::int as publish_failed,
        max(coalesce(updated_at, created_at, publish_finished_ts, publish_started_ts)) as latest_listing_ts
      from listings
      where lower(coalesce(marketplace_key, '')) = 'ebay'
    `).then((rows) => rows[0] ?? {}), {}),
    readOnlyQuery(queryFailures, "lead_summary", "lead_submissions", () =>
      tableExists("lead_submissions")
        .then((exists) =>
          exists
            ? runQuery(`
              select
                count(*)::int as total,
                count(*) filter (where upper(coalesce(status, '')) = 'NEW')::int as new_leads,
                count(*) filter (where upper(coalesce(status, '')) = 'CONTACTED')::int as contacted,
                count(*) filter (where upper(coalesce(status, '')) = 'QUALIFIED')::int as qualified,
                max(created_at) as latest_lead_ts
              from lead_submissions
            `).then((rows) => rows[0] ?? {})
            : {}
        ), {}),
    readOnlyQuery(queryFailures, "lead_recent", "lead_submissions", () =>
      tableExists("lead_submissions")
        .then((exists) =>
          exists
            ? runQuery(`
              select
                id,
                full_name,
                company,
                email,
                interest,
                status,
                email_notification_status,
                whatsapp_notification_status,
                created_at
              from lead_submissions
              order by created_at desc nulls last, id desc
              limit 8
            `)
            : []
        ), []),
    readOnlyQuery(queryFailures, "recent_jobs", "jobs", () =>
      runQuery(`
      select job_type, status, attempt, max_attempts, scheduled_ts, started_ts, finished_ts
      from jobs
      order by coalesce(finished_ts, started_ts, scheduled_ts) desc nulls last
      limit 12
    `), []),
    readOnlyQuery(queryFailures, "recent_worker_runs", "worker_runs", () =>
      runQuery(`
      with worker_runs_ranked as (
        select
          worker,
          job_name,
          job_id,
          status,
          error,
          duration_ms,
          started_at,
          finished_at,
          coalesce(finished_at, started_at) as activity_ts,
          row_number() over (
            partition by worker, job_name, job_id
            order by coalesce(finished_at, started_at) desc nulls last, started_at desc nulls last, job_id desc
          ) as row_num
        from worker_runs
      ),
      latest_worker_activity as (
        select
          worker,
          max(coalesce(finished_at, started_at)) as latest_worker_activity_ts
        from worker_runs
        group by worker
      )
      select
        r.worker,
        r.job_name,
        r.job_id,
        r.status,
        r.error,
        case
          when upper(coalesce(r.status, '')) = 'FAILED'
            and a.latest_worker_activity_ts is not null
            and r.activity_ts < a.latest_worker_activity_ts
          then 'HISTORICAL_WORKER_FAILURE'
          when upper(coalesce(r.status, '')) = 'FAILED'
          then 'CURRENT_FAILURE'
          when upper(coalesce(r.status, '')) = 'STARTED'
          then 'RUNNING'
          when upper(coalesce(r.status, '')) = 'SUCCEEDED'
          then 'LATEST_SUCCESS'
          else concat('LATEST_', upper(coalesce(r.status, 'UNKNOWN')))
        end as evidence_state,
        r.duration_ms,
        r.started_at,
        r.finished_at
      from worker_runs_ranked r
      left join latest_worker_activity a on a.worker = r.worker
      where r.row_num = 1
      order by r.activity_ts desc nulls last
      limit 12
    `), []),
    readOnlyQuery(queryFailures, "recent_audit_events", "audit_log", () =>
      runQuery(`
      select event_ts, actor_type, actor_id, entity_type, entity_id, event_type
      from audit_log
      order by event_ts desc
      limit 12
    `), []),
    getLatestSuccessfulJobTs([JOB_NAMES.TREND_EXPAND]),
    getLatestSuccessfulJobTs([JOB_NAMES.SUPPLIER_DISCOVER]),
    getLatestSuccessfulJobTs([JOB_NAMES.SCAN_MARKETPLACE_PRICE]),
    getLatestSuccessfulJobTs([JOB_NAMES.MATCH_PRODUCT]),
    getLatestSuccessfulJobTs([JOB_NAMES.EVAL_PROFIT]),
    getLatestFailedJobTs([JOB_NAMES.TREND_EXPAND, JOB_NAMES.TREND_EXPAND_REFRESH, JOB_NAMES.TREND_INGEST]),
    getLatestFailedJobTs([JOB_NAMES.SUPPLIER_DISCOVER]),
    getLatestFailedJobTs([JOB_NAMES.SCAN_MARKETPLACE_PRICE]),
    getLatestFailedJobTs([JOB_NAMES.MATCH_PRODUCT]),
    getLatestFailedJobTs([JOB_NAMES.EVAL_PROFIT]),
    readOnlyQuery(queryFailures, "queue_schedules", "bullmq_schedules", () =>
      Promise.all([
        jobsQueue.getRepeatableJobs(0, 500),
        jobsQueue.getJobSchedulers(0, 500),
      ]).then(([repeatableJobs, jobSchedulers]) => [
        repeatableJobs as QueueScheduleEntry[],
        jobSchedulers as QueueScheduleEntry[],
      ] as [QueueScheduleEntry[], QueueScheduleEntry[]]), [[], []] as [QueueScheduleEntry[], QueueScheduleEntry[]]),
    readOnlyQuery(queryFailures, "cj_proof_payload", "products_raw", () =>
      runQuery(`
        select raw_payload as cj_raw_payload
        from products_raw
        where lower(coalesce(supplier_key, '')) in ('cj', 'cj dropshipping', 'cjdropshipping')
        order by snapshot_ts desc nulls last, id desc
        limit 1
      `), []),
    readOnlyQuery(queryFailures, "cj_proof_blocked_candidates", "profitable_candidates", () =>
      runQuery(`
        select count(*)::int as count
        from profitable_candidates
        where lower(coalesce(supplier_key, '')) = 'cjdropshipping'
          and (
            upper(coalesce(listing_block_reason, '')) like '%CJ%'
            or upper(coalesce(reason, '')) like '%CJ PROOF%'
          )
      `), []),
    getCjRuntimeDiagnostics().catch(() => null),
  ]);

  const [repeatableJobs, jobSchedulers] = scheduleVisibility as [QueueScheduleEntry[], QueueScheduleEntry[]];
  const cjProofState = readCjProofStateFromRawPayload(cjProofPayloadRows[0]?.cj_raw_payload) ?? getCjProofStateSummary();
  const cjBlockedCandidates = toNum(cjProofBlockedCandidateRows[0]?.count);

  const hasRepeatable = (jobName: string, everyMs: number) =>
    repeatableJobs.some(
      (entry) =>
        entry.name === jobName &&
        Number(entry.every ?? 0) === everyMs
    );

  const hasScheduler = (jobName: string, everyMs: number) =>
    jobSchedulers.some(
      (entry) =>
        entry.name === jobName &&
        Number(entry.every ?? 0) === everyMs
    );

  const trendScheduleActive =
    hasRepeatable(JOB_NAMES.TREND_EXPAND_REFRESH, 21600000) ||
    hasScheduler(JOB_NAMES.TREND_EXPAND_REFRESH, 21600000);
  const supplierScheduleActive =
    hasRepeatable(JOB_NAMES.SUPPLIER_DISCOVER, 21600000) ||
    hasScheduler(JOB_NAMES.SUPPLIER_DISCOVER, 21600000);
  const marketplaceScheduleActive =
    hasRepeatable(JOB_NAMES.SCAN_MARKETPLACE_PRICE, 14400000) ||
    hasScheduler(JOB_NAMES.SCAN_MARKETPLACE_PRICE, 14400000);
  const matchScheduleActive =
    hasRepeatable(JOB_NAMES.MATCH_PRODUCT, 14400000) ||
    hasScheduler(JOB_NAMES.MATCH_PRODUCT, 14400000);
  const profitScheduleActive =
    hasRepeatable(JOB_NAMES.EVAL_PROFIT, 14400000) ||
    hasScheduler(JOB_NAMES.EVAL_PROFIT, 14400000);

  const hasQueryFailure = (...keys: string[]) =>
    queryFailures.some((failure) => keys.includes(failure.key));

  const trendSummary = trendSummaryRow as Row;
  const trendCandidatesSummary = trendCandidatesSummaryRow as Row;
  const supplierSummary = supplierSummaryRow as Row;
  const marketplaceSummary = marketplaceSummaryRow as Row;
  const matchingSummary = matchingSummaryRow as Row;
  const profitabilitySummary = profitabilitySummaryRow as Row;
  const listingsSummary = listingsSummaryRow as Row;
  const leadSummary = leadSummaryRow as Row;

  const trendTotal = toNum(trendSummary.total_signals);
  const trendFresh = toNum(trendSummary.fresh_signals);
  const trendManualSeedSignals = toNum(trendSummary.manual_seed_signals);
  const trendStale = Math.max(0, trendTotal - trendFresh);
  const trendLatestTs = toStr(trendSummary.latest_signal_ts);

  const supplierTotal = toNum(supplierSummary.total_rows);
  const supplierFresh = toNum(supplierSummary.fresh_rows);
  const supplierStale = toNum(supplierSummary.stale_rows);
  const supplierLatestTs = toStr(supplierSummary.latest_snapshot_ts);

  const marketplaceTotal = toNum(marketplaceSummary.total_ebay_rows);
  const marketplaceFresh = toNum(marketplaceSummary.fresh_ebay_rows);
  const marketplaceStale = toNum(marketplaceSummary.stale_ebay_rows);
  const marketplaceLatestTs = toStr(marketplaceSummary.latest_snapshot_ts);

  const totalMatches = toNum(matchingSummary.total_matches);
  const freshMatches = toNum(matchingSummary.fresh_matches);
  const staleMatches = Math.max(0, totalMatches - freshMatches);
  const lowConfidenceCount = toNum(matchingSummary.low_confidence_count);
  const averageConfidence = toNullableNum(matchingSummary.average_confidence);
  const latestMatchTs = toStr(matchingSummary.latest_match_ts);

  const totalCandidates = toNum(profitabilitySummary.total_candidates);
  const approved = toNum(profitabilitySummary.approved);
  const manualReview = toNum(profitabilitySummary.manual_review);
  const rejected = toNum(profitabilitySummary.rejected);
  const pending = toNum(profitabilitySummary.pending);
  const freshCandidates = toNum(profitabilitySummary.fresh_candidates);
  const actionableFresh = toNum(profitabilitySummary.actionable_fresh);
  const approvedFresh = toNum(profitabilitySummary.approved_fresh);
  const freshLive = toNum(profitabilitySummary.fresh_live);
  const manualReviewDueToStale = toNum(profitabilitySummary.manual_review_due_to_stale);
  const blockedByStaleSnapshot = toNum(profitabilitySummary.blocked_by_stale_snapshot);
  const blockedByLowConfidence = toNum(profitabilitySummary.blocked_by_low_confidence);
  const blockedByAvailability = toNum(profitabilitySummary.blocked_by_availability);
  const blockedByAlreadyLive = toNum(profitabilitySummary.blocked_by_already_live);
  const blockedByPolicyOrManualReview = toNum(profitabilitySummary.blocked_by_policy_or_manual_review);
  const latestCalcTs = toStr(profitabilitySummary.latest_calc_ts);
  const staleCandidates = Math.max(0, totalCandidates - freshCandidates);

  const readyToPublish = toNum(listingsSummary.ready_to_publish);
  const preview = toNum(listingsSummary.preview);
  const active = toNum(listingsSummary.active);
  const publishFailed = toNum(listingsSummary.publish_failed);
  const latestListingTs = toStr(listingsSummary.latest_listing_ts);
  const totalLeads = toNum(leadSummary.total);
  const newLeads = toNum(leadSummary.new_leads);
  const contactedLeads = toNum(leadSummary.contacted);
  const qualifiedLeads = toNum(leadSummary.qualified);
  const latestLeadTs = toStr(leadSummary.latest_lead_ts);

  const stages: StageStatus[] = [
    buildStageStatus({
      key: "trend",
      label: "Trend intake",
      thresholdHours: trendWindowHours,
      lastDataTs: trendLatestTs,
      lastSuccessfulRunTs: trendJobTs,
      totalRows: trendTotal,
      freshRows: trendFresh,
      staleRows: trendStale,
      actionableHref: buildDashboardAlertHref({ surface: 'control', params: { stage: 'trend' } }),
      queryFailed: hasQueryFailure('trend_summary', 'trend_recent_signals', 'trend_recent_candidates', 'trend_candidates_summary'),
      detailFresh: `${trendFresh}/${trendTotal} trend signals were captured in the last ${trendWindowHours}h.`,
      detailStale:
        trendFresh === 0
          ? `No trend signals were captured in the last ${trendWindowHours}h. Latest trend signal is older data.`
          : `${trendStale} trend signals are older than ${trendWindowHours}h.`,
      detailUnknown: "Trend signal data is unavailable.",
      detailFailure: "Trend intake query failed; canonical trend status is unavailable.",
    }),
    buildStageStatus({
      key: "supplier",
      label: "Supplier ingestion",
      thresholdHours: supplierWindowHours,
      lastDataTs: supplierLatestTs,
      lastSuccessfulRunTs: supplierJobTs,
      totalRows: supplierTotal,
      freshRows: supplierFresh,
      staleRows: supplierStale,
      actionableHref: buildDashboardAlertHref({ surface: 'review', params: { supplier: 'cjdropshipping' } }),
      queryFailed: hasQueryFailure('supplier_summary', 'supplier_by_supplier'),
      detailFresh: `${supplierFresh}/${supplierTotal} supplier snapshots are within the ${supplierWindowHours}h policy window.`,
      detailStale:
        supplierFresh === 0
          ? `No supplier snapshots are within the ${supplierWindowHours}h policy window.`
          : `${supplierStale} supplier snapshots are outside the ${supplierWindowHours}h policy window.`,
      detailUnknown: "Supplier snapshot freshness is unavailable.",
      detailFailure: "Supplier freshness query failed; canonical supplier status is unavailable.",
    }),
    buildStageStatus({
      key: "marketplace",
      label: "Marketplace scan",
      thresholdHours: marketplaceWindowHours,
      lastDataTs: marketplaceLatestTs,
      lastSuccessfulRunTs: marketplaceJobTs,
      totalRows: marketplaceTotal,
      freshRows: marketplaceFresh,
      staleRows: marketplaceStale,
      actionableHref: buildDashboardAlertHref({ surface: 'review', params: { marketplace: 'ebay' } }),
      queryFailed: hasQueryFailure('marketplace_summary'),
      detailFresh: `${marketplaceFresh}/${marketplaceTotal} eBay marketplace snapshots are fresh.`,
      detailStale:
        marketplaceFresh === 0
          ? `No eBay marketplace snapshots are within the ${marketplaceWindowHours}h policy window.`
          : `${marketplaceStale} eBay marketplace snapshots are stale.`,
      detailUnknown: "Marketplace scan freshness is unavailable.",
      detailFailure: "Marketplace freshness query failed; canonical marketplace status is unavailable.",
    }),
    buildStageStatus({
      key: "matching",
      label: "Matching",
      thresholdHours: matchWindowHours,
      lastDataTs: latestMatchTs,
      lastSuccessfulRunTs: matchJobTs,
      totalRows: totalMatches,
      freshRows: freshMatches,
      staleRows: staleMatches,
      actionableHref: buildDashboardAlertHref({ surface: 'review', params: { marketplace: 'ebay', sort: 'match' } }),
      queryFailed: hasQueryFailure('matching_summary', 'matching_recent'),
      detailFresh: `${freshMatches}/${totalMatches} active eBay matches were refreshed in the last ${matchWindowHours}h.`,
      detailStale:
        freshMatches === 0
          ? `No active eBay matches were refreshed in the last ${matchWindowHours}h.`
          : `${staleMatches} active eBay matches are older than ${matchWindowHours}h.`,
      detailUnknown: "Matching freshness is unavailable.",
      detailFailure: "Matching freshness query failed; canonical matching status is unavailable.",
    }),
    buildStageStatus({
      key: "profitability",
      label: "Profitability",
      thresholdHours: profitabilityWindowHours,
      lastDataTs: latestCalcTs,
      lastSuccessfulRunTs: profitJobTs,
      totalRows: totalCandidates,
      freshRows: freshCandidates,
      staleRows: staleCandidates,
      actionableHref: buildDashboardAlertHref({ surface: 'review', params: { marketplace: 'ebay' } }),
      queryFailed: hasQueryFailure('profitability_summary', 'profitability_status_breakdown', 'profitability_block_breakdown', 'profitability_top_opportunities'),
      detailFresh:
        freshCandidates === totalCandidates
          ? `${freshCandidates}/${totalCandidates} profitable candidates have fresh profitability inputs. ${actionableFresh} are actionable and ${freshLive} are already ACTIVE listings.`
          : `${freshCandidates}/${totalCandidates} profitable candidates have fresh profitability inputs. ${actionableFresh} are actionable and ${freshLive} are already ACTIVE listings.`,
      detailStale:
        freshCandidates === 0
          ? `No profitable candidates currently have fresh supplier, marketplace, and profitability inputs.`
          : `${staleCandidates} profitable candidates still rely on stale upstream inputs.`,
      detailUnknown: "Profitability freshness is unavailable.",
      detailFailure: "Profitability query failed; canonical candidate status is unavailable.",
    }),
    buildStageStatus({
      key: "listing_readiness",
      label: "Listing readiness",
      thresholdHours: profitabilityWindowHours,
      lastDataTs: latestListingTs,
      lastSuccessfulRunTs: latestListingTs,
      totalRows: readyToPublish + preview + active + publishFailed,
      freshRows: readyToPublish + active,
      staleRows: publishFailed,
      actionableHref: buildDashboardAlertHref({ surface: 'listings', params: { status: 'PUBLISH_FAILED', marketplace: 'ebay' } }),
      queryFailed: hasQueryFailure('listings_summary'),
      detailFresh: `${readyToPublish} listings are READY_TO_PUBLISH and ${active} are ACTIVE.`,
      detailStale:
        publishFailed > 0
          ? `${publishFailed} eBay listings are in PUBLISH_FAILED.`
          : `${preview} listings remain in PREVIEW awaiting further action.`,
      detailUnknown: "Listing readiness data is unavailable.",
      detailFailure: "Listing readiness query failed; canonical listing status is unavailable.",
    }),
  ];

  for (const stage of stages) {
    if (stage.key === "trend") {
      stage.latestFailedRunTs = trendFailedJobTs;
      stage.scheduleActive = trendScheduleActive;
      stage.dominantBlocker = !trendScheduleActive
        ? "missing schedule"
        : !trendJobTs
          ? "missing worker evidence"
          : stage.healthStatus !== "FRESH_HEALTHY"
            ? "stale upstream data"
            : "none";
      stage.detail = `${stage.detail} ${
        stage.dominantBlocker === "none"
          ? "Automation is scheduled and has worker evidence."
          : `Dominant blocker: ${stage.dominantBlocker}.`
      }`;
    }
    if (stage.key === "supplier") {
      stage.latestFailedRunTs = supplierFailedJobTs;
      stage.scheduleActive = supplierScheduleActive;
      stage.dominantBlocker = !supplierScheduleActive
        ? "missing schedule"
        : !supplierJobTs
          ? "missing worker evidence"
          : stage.healthStatus !== "FRESH_HEALTHY"
            ? "stale upstream data"
            : "none";
      stage.detail = `${stage.detail} ${
        stage.dominantBlocker === "none"
          ? "Automation is scheduled and has worker evidence."
          : `Dominant blocker: ${stage.dominantBlocker}.`
      }`;
    }
    if (stage.key === "marketplace") {
      stage.latestFailedRunTs = marketplaceFailedJobTs;
      stage.scheduleActive = marketplaceScheduleActive;
      stage.dominantBlocker = !marketplaceScheduleActive
        ? "missing schedule"
        : !marketplaceJobTs
          ? "missing worker evidence"
          : stage.healthStatus !== "FRESH_HEALTHY"
            ? "stale upstream data"
            : "none";
      stage.detail = `${stage.detail} ${
        stage.dominantBlocker === "none"
          ? "Automation is scheduled and has worker evidence."
          : `Dominant blocker: ${stage.dominantBlocker}.`
      }`;
    }
    if (stage.key === "matching") {
      stage.latestFailedRunTs = matchFailedJobTs;
      stage.scheduleActive = matchScheduleActive;
      stage.dominantBlocker = !matchScheduleActive
        ? "missing schedule"
        : !matchJobTs
          ? "missing worker evidence"
          : stage.healthStatus !== "FRESH_HEALTHY"
            ? "stale upstream data"
            : "none";
      stage.detail = `${stage.detail} ${
        stage.dominantBlocker === "none"
          ? "Automation is scheduled and has worker evidence."
          : `Dominant blocker: ${stage.dominantBlocker}.`
      }`;
    }
    if (stage.key === "profitability") {
      stage.latestFailedRunTs = profitFailedJobTs;
      stage.scheduleActive = profitScheduleActive;
      stage.dominantBlocker = !profitScheduleActive
        ? "missing schedule"
        : !profitJobTs
          ? "missing worker evidence"
          : stage.healthStatus === "FRESH_HEALTHY"
            ? "none"
          : blockedByStaleSnapshot > 0
            ? "blocked downstream freshness"
          : blockedByAlreadyLive === totalCandidates && totalCandidates > 0
              ? "already live inventory"
              : "policy/manual review";
      stage.detail = `${stage.detail} ${
        stage.dominantBlocker === "none"
          ? "Automation is scheduled and has worker evidence."
          : `Dominant blocker: ${stage.dominantBlocker}.`
      }`;
    }
  }

  const alerts: DashboardData["alerts"] = [];
  if (marketplaceFresh === 0) {
    alerts.push({
      id: "stale-marketplace-data",
      tone: "error",
      title: "Marketplace scan is stale",
      detail: `No eBay marketplace snapshots are within the ${marketplaceWindowHours}h policy window.`,
      href: buildDashboardAlertHref({ surface: "review", params: { marketplace: "ebay", reason: "stale_snapshot" } }),
    });
  }
  if (manualReviewDueToStale > 0) {
    alerts.push({
      id: "manual-review-due-stale-snapshots",
      tone: "warning",
      title: "Profitable candidates are blocked by stale snapshots",
      detail: `${manualReviewDueToStale} profitable candidates are in MANUAL_REVIEW because snapshot freshness is outside policy.`,
      href: buildDashboardAlertHref({ surface: "review", params: { reason: "stale_snapshot", marketplace: "ebay" } }),
    });
  }
  if (trendFresh === 0) {
    alerts.push({
      id: "stale-trends",
      tone: "warning",
      title: "Trend intake is stale",
      detail: `No trend signals were captured in the last ${trendWindowHours}h.`,
      href: buildDashboardAlertHref({ surface: "control", params: { stage: "trend" } }),
    });
  }
  if (supplierFresh === 0) {
    alerts.push({
      id: "stale-supplier-snapshots",
      tone: "warning",
      title: "Supplier ingestion is stale",
      detail: `No supplier snapshots are within the ${supplierWindowHours}h policy window.`,
      href: buildDashboardAlertHref({ surface: "review", params: { supplier: "cjdropshipping" } }),
    });
  }
  if (publishFailed > 0) {
    alerts.push({
      id: "publish-failures",
      tone: "error",
      title: "Listing publish failures need attention",
      detail: `${publishFailed} eBay listings are currently in PUBLISH_FAILED.`,
      href: buildDashboardAlertHref({ surface: "listings", params: { status: "PUBLISH_FAILED", marketplace: "ebay" } }),
    });
  }
  if (cjProofState.orderCreate !== "PROVEN") {
    alerts.push({
      id: "cj-order-create-proof-missing",
      tone: "warning",
      title: "CJ order-create proof regressed",
      detail: "CJ order-create is no longer proven in this snapshot, so candidate confidence and purchase automation must return to fail-closed mode.",
      href: buildDashboardAlertHref({ surface: "control", params: { stage: "cj-proof" } }),
    });
  }
  if (cjRuntime && cjRuntime.runtimeTruthStatus === "LIVE_VERIFIED") {
    alerts.push({
      id: "cj-runtime-truth-preferred",
      tone: "warning",
      title: "CJ runtime truth is live-verified",
      detail: "If the CJ portal still shows an API-store warning, treat that warning as informational context only.",
      href: buildDashboardAlertHref({ surface: "control", params: { stage: "cj-proof" } }),
    });
  }
  if (cjProofState.tracking !== "PROVEN") {
    alerts.push({
      id: "cj-tracking-proof-missing",
      tone: "warning",
      title: "CJ tracking remains unproven",
      detail: "CJ tracking sync stays in partial-proof mode until a real tracking number is validated.",
      href: buildDashboardAlertHref({ surface: "control", params: { stage: "cj-proof" } }),
    });
  }
  if (trendManualSeedSignals === trendTotal && trendTotal > 0) {
    alerts.push({
      id: "manual-seed-trends-only",
      tone: "warning",
      title: "Trend coverage is still dominated by manual seed data",
      detail: `${trendManualSeedSignals}/${trendTotal} current trend signals are manual/seed rows.`,
      href: buildDashboardAlertHref({ surface: "control", params: { stage: "trend", reason: "manual_seed_only" } }),
    });
  }

  if (queryFailures.length > 0) {
    alerts.push({
      id: "dashboard-query-failures",
      tone: "error",
      title: "Dashboard has partial query failures",
      detail: `${queryFailures.length} dashboard query groups failed. Canonical zero values are not inferred for those groups.`,
      href: buildDashboardAlertHref({ surface: "control", params: { tab: "diagnostics" } }),
    });
  }

  const pipelineMetrics: PipelineMetric[] = [
    {
      key: "trend_signals",
      label: "Trend signals",
      totalRows: trendTotal,
      freshRows: trendFresh,
      staleRows: trendStale,
      freshnessWindow: `${trendWindowHours}h`,
      scope: "Canonical trend_signals rows. Manual seed rows are not treated as broad trend health.",
    },
    {
      key: "trend_candidates",
      label: "Trend candidates",
      totalRows: toNum(trendCandidatesSummary.total_rows),
      freshRows: toNum(trendCandidatesSummary.fresh_rows),
      staleRows: toNum(trendCandidatesSummary.stale_rows),
      freshnessWindow: `${trendWindowHours}h`,
      scope: "Canonical trend_candidates rows ordered by created_ts.",
    },
    {
      key: "products_raw",
      label: "Supplier snapshots",
      totalRows: supplierTotal,
      freshRows: supplierFresh,
      staleRows: supplierStale,
      freshnessWindow: `${supplierWindowHours}h`,
      scope: "Canonical products_raw snapshots. All-time totals may include historical/sample supplier rows.",
    },
    {
      key: "marketplace_prices",
      label: "eBay marketplace snapshots",
      totalRows: marketplaceTotal,
      freshRows: marketplaceFresh,
      staleRows: marketplaceStale,
      freshnessWindow: `${marketplaceWindowHours}h`,
      scope: "eBay-only v1 canonical marketplace_prices rows.",
    },
    {
      key: "matches",
      label: "Active eBay matches",
      totalRows: totalMatches,
      freshRows: freshMatches,
      staleRows: staleMatches,
      freshnessWindow: `${matchWindowHours}h`,
      scope: "Active eBay matches by last_seen_ts.",
    },
    {
      key: "profitable_candidates",
      label: "eBay profitable candidates",
      totalRows: totalCandidates,
      freshRows: freshCandidates,
      staleRows: staleCandidates,
      freshnessWindow: `${profitabilityWindowHours}h`,
      scope: "Fresh rows require fresh supplier + marketplace snapshots and current calc_ts; actionability is tracked separately.",
    },
  ];

  const criticalIssues = alerts.filter((alert) => alert.tone === "error").length;

  return {
    generatedAt: new Date().toISOString(),
    cjProofState: {
      overall: cjProofState.overall,
      auth: cjProofState.auth,
      freight: cjProofState.freight,
      orderCreate: cjProofState.orderCreate,
      orderDetail: cjProofState.orderDetail,
      tracking: cjProofState.tracking,
      blockingReason: getCjProofBlockingReason(cjProofState),
      blockedCandidates: cjBlockedCandidates,
    },
    cjRuntime: {
      runtimeTruthStatus: cjRuntime?.runtimeTruthStatus ?? "UNAVAILABLE",
      sandbox: cjRuntime?.settings?.sandbox ?? null,
      qpsLimit: cjRuntime?.settings?.qpsLimit ?? null,
      quotaLimit: cjRuntime?.settings?.quotaLimit ?? null,
      quotaRemaining: cjRuntime?.settings?.quotaRemaining ?? null,
      shopsCount: cjRuntime?.shopsCount ?? null,
      lastSuccessfulSettingsRefreshAt: cjRuntime?.settings?.lastSuccessfulRefreshAt ?? null,
      portalWarningPolicyNote: cjRuntime?.portalWarningPolicyNote ?? "",
    },
    infrastructure: {
      db: dbHealth,
      redis: redisHealth,
      environment: {
        nodeEnv: process.env.NODE_ENV ?? "unknown",
        vercelEnv: process.env.VERCEL_ENV ?? "unknown",
      },
    },
    refreshBehavior: getReadOnlyRefreshDescription(),
    headline: {
      actionableFreshCandidates: actionableFresh,
      approvedFreshCandidates: approvedFresh,
      manualReviewDueToStale,
      staleMarketplaceSnapshots: marketplaceStale,
      criticalIssues,
    },
    stages,
    pipelineMetrics,
    trend: {
      totalSignals: trendTotal,
      recentSignals24h: trendFresh,
      manualSeedSignals: trendManualSeedSignals,
      latestSignalTs: trendLatestTs,
      latestSuccessfulRunTs: trendJobTs,
      recentSignals,
      recentCandidates: recentTrendCandidates,
    },
    supplier: {
      totalRows: supplierTotal,
      freshRows: supplierFresh,
      staleRows: supplierStale,
      latestSnapshotTs: supplierLatestTs,
      latestSuccessfulRunTs: supplierJobTs,
      bySupplier: supplierBySupplier,
    },
    marketplace: {
      totalEbayRows: marketplaceTotal,
      freshEbayRows: marketplaceFresh,
      staleEbayRows: marketplaceStale,
      latestSnapshotTs: marketplaceLatestTs,
      latestSuccessfulRunTs: marketplaceJobTs,
    },
    matching: {
      totalMatches,
      freshMatches24h: freshMatches,
      lowConfidenceCount,
      averageConfidence,
      latestMatchTs,
      latestSuccessfulRunTs: matchJobTs,
      recentMatches,
    },
    profitability: {
      totalCandidates,
      approved,
      manualReview,
      rejected,
      pending,
      actionableFresh,
      approvedFresh,
      manualReviewDueToStale,
      blockedByStaleSnapshot,
      blockedByLowConfidence,
      blockedByAvailability,
      blockedByPolicyOrManualReview,
      latestCalcTs,
      latestSuccessfulRunTs: profitJobTs,
      statusBreakdown: profitabilityStatusBreakdown,
      blockBreakdown: profitabilityBlockBreakdown,
      topOpportunities,
    },
    listingReadiness: {
      readyToPublish,
      preview,
      active,
      publishFailed,
      latestListingTs,
    },
    leadPipeline: {
      total: totalLeads,
      newLeads,
      contacted: contactedLeads,
      qualified: qualifiedLeads,
      latestLeadTs,
      recentLeads,
    },
    diagnostics: {
      recentJobs,
      recentWorkerRuns,
      recentAuditEvents,
    },
    queryFailures,
    fieldLineage: [
      {
        field: "headline.actionableFreshCandidates",
        source: "profitable_candidates + products_raw + marketplace_prices",
        query: "candidate_truth aggregate in getDashboardData",
        businessRule: "Count only APPROVED, listing-eligible, fresh candidates on normalized ebay scope.",
        failureMode: "If profitability aggregate fails, dashboard must not infer zero actionables from missing data.",
      },
      {
        field: "headline.staleMarketplaceSnapshots",
        source: "marketplace_prices",
        query: "ebay-only freshness aggregate in getDashboardData",
        businessRule: "Latest row existence never overrides fresh-window failure; stale rows remain stale.",
        failureMode: "If snapshot aggregate fails, stale count is unknown and alerting must fail closed.",
      },
      {
        field: "stages[*]",
        source: "canonical DB truth + worker_runs + queue schedule metadata",
        query: "buildStageStatus + latest worker run timestamps + repeatable scheduler visibility",
        businessRule: "Freshness, health, coverage, and severity are derived centrally with one deterministic state each.",
        failureMode: "Missing worker evidence or schedule visibility downgrades health; query failure renders query-failed state.",
      },
      {
        field: "supplier.bySupplier",
        source: "products_raw",
        query: "normalized supplier snapshot aggregate",
        businessRule: "Supplier keys are normalized before grouping so CJ aliases cannot double count.",
        failureMode: "If grouping fails, supplier coverage must be treated as unknown rather than zero.",
      },
      {
        field: "alerts[*]",
        source: "same dashboard aggregates as cards",
        query: "alert assembly in getDashboardData",
        businessRule: "Every alert links to the admin surface filtered to the same canonical dataset and reason.",
        failureMode: "If upstream data is missing, emit failure-state alerting instead of silent suppression.",
      },
      {
        field: "infrastructure.db",
        source: "database connectivity",
        query: "select 1 as ok",
        businessRule: "Dashboard infrastructure state reflects direct read-only DB connectivity, not cached health heuristics.",
        failureMode: "DB health query failure is rendered as infrastructure error, not a healthy zero state.",
      },
      {
        field: "infrastructure.redis",
        source: "redis client ping",
        query: "redis.ping()",
        businessRule: "Redis status reflects live ping visibility only; missing client export remains unknown rather than healthy.",
        failureMode: "Redis probe failure stays explicit and does not overwrite DB truth or stage freshness.",
      },
      {
        field: "trend.*",
        source: "trend_signals + trend_candidates + worker_runs",
        query: "trend summary, recent rows, and latest worker success queries",
        businessRule: "Current trend health requires fresh canonical signals plus worker evidence; manual seed dominance is advisory only.",
        failureMode: "Trend query failure forces query-failed/unknown state and blocks zero rendering.",
      },
      {
        field: "supplier.*",
        source: "products_raw + worker_runs",
        query: "supplier freshness aggregate and normalized supplier breakdown",
        businessRule: "Supplier freshness is grouped on canonical supplier keys before aggregation.",
        failureMode: "Supplier query failure is explicit; missing snapshots are not fabricated as zero rows.",
      },
      {
        field: "marketplace.*",
        source: "marketplace_prices + worker_runs",
        query: "ebay-only snapshot freshness aggregate",
        businessRule: "Latest marketplace row existence does not override freshness-window failure.",
        failureMode: "Marketplace aggregate failure remains query-failed and drives actionable diagnostics instead of false health.",
      },
      {
        field: "matching.*",
        source: "matches + worker_runs",
        query: "active-ebay match freshness and confidence aggregate",
        businessRule: "Only ACTIVE ebay matches contribute to current matching health.",
        failureMode: "Matching query failure leaves match health unknown/query-failed rather than zero active matches.",
      },
      {
        field: "profitability.*",
        source: "profitable_candidates + products_raw + marketplace_prices + listings + worker_runs",
        query: "candidate_truth aggregates, blocker breakdown, top-opportunity query",
        businessRule: "Fresh profitability requires fresh supplier inputs, fresh marketplace inputs, and current calc timestamps.",
        failureMode: "Profitability query failure invalidates current actionability instead of reporting empty approved/fresh pools.",
      },
      {
        field: "listingReadiness.*",
        source: "listings",
        query: "ebay listing status aggregate",
        businessRule: "Listing readiness is a read-only status aggregate and never a publish trigger.",
        failureMode: "Listing-status query failure remains explicit and is not shown as zero failed listings or zero ready listings.",
      },
      {
        field: "leadPipeline.*",
        source: "lead_submissions",
        query: "lead status aggregate and recent leads query",
        businessRule: "Lead metrics reflect persisted DB intake only, not notification-side assumptions.",
        failureMode: "If the lead query fails, the dashboard shows a query failure rather than an empty lead queue.",
      },
      {
        field: "diagnostics.*",
        source: "jobs + worker_runs + audit_log + BullMQ schedule metadata",
        query: "recent jobs, recent worker runs, recent audit events, schedule visibility",
        businessRule: "Diagnostics surfaces are evidence only and never override canonical metric truth.",
        failureMode: "Diagnostic query failure is listed in queryFailures and alerting instead of silently dropping evidence.",
      },
    ],
    adminLinks: [
      { label: "Operational Control Panel", href: "/admin/control", note: "Quick actions, queue health, safety overrides." },
      { label: "Review Console", href: "/admin/review", note: "Decisioning and candidate diagnostics." },
      { label: "Listings Console", href: "/admin/listings", note: "Readiness, publish failures, recovery actions." },
      { label: "Orders Console", href: "/admin/orders", note: "Order operations and purchase-safety follow-up." },
    ],
    alerts,
  };
}
