import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  getListingIntegritySummary,
  healListingIntegrity,
  listBrokenLineageListings,
} from "@/lib/listings/integrity";
import {
  automateShippingIntelligence,
  findShippingBlockedCandidates,
} from "@/lib/pricing/shippingAutomation";
import { getMatchedSupplierRefreshTargets, refreshMatchedSupplierRows } from "@/lib/products/refreshMatchedSupplierRows";
import { handleMarketplaceScanJob } from "@/lib/jobs/marketplaceScan";
import { handleMatchProductsJob } from "@/lib/jobs/matchProducts";
import { runProfitEngine } from "@/lib/profit/profitEngine";
import { prepareListingPreviews } from "@/lib/listings/prepareListingPreviews";
import { promoteApprovedPreviewsToReady } from "@/lib/listings/promoteReadyBatch";
import { getSupplierRefreshTelemetry } from "@/lib/suppliers/telemetry";
import { runListingExecution } from "@/workers/listingExecute.worker";
import { getLearningHubScorecard } from "@/lib/learningHub/scorecard";
import { runContinuousLearningRefresh } from "@/lib/learningHub/continuousLearning";
import { recordOperationalSummaryLearning } from "@/lib/learningHub/pipelineWriters";

export type AutonomousOpsPhase = "full" | "diagnostics_refresh" | "prepare" | "publish";
type ActorType = "ADMIN" | "WORKER" | "SYSTEM";
export type StageKey =
  | "runtime_diagnostics"
  | "integrity_scan"
  | "integrity_heal"
  | "supplier_refresh"
  | "marketplace_refresh"
  | "shipping_refresh"
  | "match_recompute"
  | "profit_recompute"
  | "listing_prepare"
  | "publish_ready_promotion"
  | "guarded_publish_execution"
  | "health_summary";

export type AutonomousOpsStageResult = {
  key: StageKey;
  status: "completed" | "paused" | "failed" | "skipped";
  reasonCode: string | null;
  counts: Record<string, number | string | boolean | null>;
  details?: unknown;
};

export type AutonomousOpsSummary = {
  runtime: {
    dotenvPath: string | null;
    envSource: string | null;
    dbTargetClassification: string | null;
    hasEbayClientId: boolean;
    hasEbayClientSecret: boolean;
  };
  pipeline: {
    approved: number;
    manualReview: number;
    readyToPublish: number;
    preview: number;
    active: number;
    publishFailed: number;
  };
  blockReasons: Array<{ reason: string; count: number }>;
  integrity: Awaited<ReturnType<typeof getListingIntegritySummary>>;
  shippingBlocks: number;
  supplierReliability: Array<{
    supplierKey: string;
    candidates: number;
    shippingBlocked: number;
    supplierBlocked: number;
    refreshSuccessRate: number | null;
    exactMatches: number;
    refreshAttempts: number;
    rateLimitEvents: number;
    exactMatchMisses: number;
  }>;
  candidateUniverse: {
    supplierMix: Array<{
      supplierKey: string;
      totalCandidates: number;
      shippingBlocked: number;
      stockBlocked: number;
      staleBlocked: number;
      publishable: number;
      manualReview: number;
      shareOfPool: number;
    }>;
    shippingKnownRatio: number;
    stockKnownRatio: number;
    staleRatio: number;
    publishableRatio: number;
    manualReviewRatio: number;
    blockedByShippingRatio: number;
    blockedByProfitRatio: number;
    blockedByLinkageRatio: number;
  };
  marketplaceReliability: {
    staleMarketplaceCandidates: number;
    freshMarketplaceRows24h: number;
    staleMarketplaceRows24h: number;
  };
  publish: {
    failed24h: number;
    activeListings: number;
  };
  manualPurchaseQueueCount: number;
  repeatCustomerGrowth: {
    repeatCustomers: number;
    newRepeatCustomers30d: number;
  };
};

export type AutonomousOpsRunResult = {
  ok: boolean;
  phase: AutonomousOpsPhase;
  actorId: string;
  generatedAt: string;
  pauses: Array<{ stage: StageKey; reason: string }>;
  stages: AutonomousOpsStageResult[];
  summary: AutonomousOpsSummary;
};

export type RuntimeDiagnostics = {
  dotenvPath: string;
  envSource: string | null;
  dbTargetClassification: string | null;
  hasEbayClientId: boolean;
  hasEbayClientSecret: boolean;
  sensitiveFilePolicy?: {
    canonical: Array<{ file: string; present: boolean }>;
    compatibility: Array<{ file: string; present: boolean }>;
    shouldNotBePresent: Array<{ file: string; present: boolean }>;
    operatingBranch: "main";
    canonicalFullCycleCommand: "pnpm ops:full-cycle";
  };
  sensitiveFilesPresent?: string[];
};

function normalizeActorType(value?: string): ActorType {
  if (value === "ADMIN" || value === "WORKER") return value;
  return "SYSTEM";
}

function stageIncluded(phase: AutonomousOpsPhase, key: StageKey): boolean {
  if (phase === "full") return true;
  if (phase === "diagnostics_refresh") {
    return !["listing_prepare", "publish_ready_promotion", "guarded_publish_execution"].includes(key);
  }
  if (phase === "prepare") {
    return [
      "runtime_diagnostics",
      "integrity_scan",
      "integrity_heal",
      "shipping_refresh",
      "match_recompute",
      "profit_recompute",
      "listing_prepare",
      "publish_ready_promotion",
      "health_summary",
    ].includes(key);
  }
  if (phase === "publish") {
    return [
      "runtime_diagnostics",
      "integrity_scan",
      "integrity_heal",
      "guarded_publish_execution",
      "health_summary",
    ].includes(key);
  }
  return false;
}

function toStageErrorCode(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, "_").slice(0, 120).toUpperCase();
  }
  return "UNKNOWN_STAGE_FAILURE";
}

function toStageErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? null };
  }
  return { message: String(error), stack: null };
}

export async function getRuntimeDiagnostics(): Promise<RuntimeDiagnostics> {
  const mod = await import("../../../scripts/lib/runtimeDiagnostics.mjs");
  const diagnostics = await mod.getRuntimeDiagnostics({ includeConnectivity: false });
  return {
    dotenvPath: String(diagnostics.dotenvPath ?? ""),
    envSource: diagnostics.envSource ? String(diagnostics.envSource) : null,
    dbTargetClassification: diagnostics.dbTargetClassification
      ? String(diagnostics.dbTargetClassification)
      : null,
    hasEbayClientId: Boolean(diagnostics.hasEbayClientId),
    hasEbayClientSecret: Boolean(diagnostics.hasEbayClientSecret),
    sensitiveFilePolicy: diagnostics.sensitiveFilePolicy ?? undefined,
    sensitiveFilesPresent: Array.isArray(diagnostics.sensitiveFilesPresent)
      ? diagnostics.sensitiveFilesPresent.map((value: unknown) => String(value))
      : undefined,
  };
}

async function getPipelineCounts() {
  const result = await db.execute<{
    approved: number;
    manualReview: number;
    readyToPublish: number;
    preview: number;
    active: number;
    publishFailed: number;
  }>(sql`
    WITH latest_listing AS (
      SELECT DISTINCT ON (l.candidate_id, lower(l.marketplace_key))
        l.candidate_id,
        lower(l.marketplace_key) AS marketplace_key,
        l.status
      FROM listings l
      ORDER BY l.candidate_id, lower(l.marketplace_key), l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
    )
    SELECT
      count(*) FILTER (WHERE pc.decision_status = 'APPROVED')::int AS approved,
      count(*) FILTER (WHERE pc.decision_status = 'MANUAL_REVIEW')::int AS "manualReview",
      count(*) FILTER (WHERE ll.status = 'READY_TO_PUBLISH')::int AS "readyToPublish",
      count(*) FILTER (WHERE ll.status = 'PREVIEW')::int AS preview,
      count(*) FILTER (WHERE ll.status = 'ACTIVE')::int AS active,
      count(*) FILTER (WHERE ll.status = 'PUBLISH_FAILED')::int AS "publishFailed"
    FROM profitable_candidates pc
    LEFT JOIN latest_listing ll
      ON ll.candidate_id = pc.id
     AND ll.marketplace_key = lower(pc.marketplace_key)
    WHERE lower(pc.marketplace_key) = 'ebay'
  `);
  return result.rows?.[0] ?? {
    approved: 0,
    manualReview: 0,
    readyToPublish: 0,
    preview: 0,
    active: 0,
    publishFailed: 0,
  };
}

async function getBlockedReasonDistribution(limit = 12) {
  const result = await db.execute<{ reason: string; count: number }>(sql`
    SELECT
      coalesce(pc.listing_block_reason, '<null>') AS reason,
      count(*)::int AS count
    FROM profitable_candidates pc
    WHERE lower(pc.marketplace_key) = 'ebay'
    GROUP BY 1
    ORDER BY count DESC, reason ASC
    LIMIT ${limit}
  `);
  return result.rows ?? [];
}

async function getCandidateUniverseScorecard() {
  const bySupplierResult = await db.execute<{
    supplierKey: string;
    totalCandidates: number;
    shippingBlocked: number;
    stockBlocked: number;
    staleBlocked: number;
    publishable: number;
    manualReview: number;
  }>(sql`
    SELECT
      lower(pc.supplier_key) AS "supplierKey",
      count(*)::int AS "totalCandidates",
      count(*) FILTER (
        WHERE coalesce(pc.listing_block_reason, '') LIKE 'shipping intelligence unresolved:%'
           OR coalesce(pc.listing_block_reason, '') = 'MISSING_SHIPPING_INTELLIGENCE'
           OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%SHIPPING_SIGNAL_%'
      )::int AS "shippingBlocked",
      count(*) FILTER (
        WHERE upper(coalesce(pc.listing_block_reason, '')) LIKE '%STOCK%'
           OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%AVAILABILITY NOT CONFIRMED%'
           OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%SUPPLIER_AVAILABILITY%'
           OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%SUPPLIER_LOW_STOCK%'
      )::int AS "stockBlocked",
      count(*) FILTER (
        WHERE upper(coalesce(pc.listing_block_reason, '')) LIKE '%STALE_MARKETPLACE%'
           OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%STALE_SUPPLIER%'
      )::int AS "staleBlocked",
      count(*) FILTER (
        WHERE pc.decision_status = 'APPROVED'
          AND coalesce(pc.listing_eligible, false) = true
      )::int AS publishable,
      count(*) FILTER (WHERE pc.decision_status = 'MANUAL_REVIEW')::int AS "manualReview"
    FROM profitable_candidates pc
    WHERE lower(pc.marketplace_key) = 'ebay'
    GROUP BY 1
    ORDER BY "totalCandidates" DESC, "supplierKey" ASC
  `);

  const totalsResult = await db.execute<{
    totalCandidates: number;
    shippingKnown: number;
    stockKnown: number;
    staleBlocked: number;
    publishable: number;
    manualReview: number;
    blockedByShipping: number;
    blockedByProfit: number;
    blockedByLinkage: number;
  }>(sql`
    SELECT
      count(*)::int AS "totalCandidates",
      count(*) FILTER (
        WHERE coalesce(pc.listing_block_reason, '') NOT LIKE 'shipping intelligence unresolved:%'
          AND coalesce(pc.listing_block_reason, '') <> 'MISSING_SHIPPING_INTELLIGENCE'
          AND upper(coalesce(pc.listing_block_reason, '')) NOT LIKE '%SHIPPING_SIGNAL_%'
      )::int AS "shippingKnown",
      count(*) FILTER (
        WHERE upper(coalesce(pc.listing_block_reason, '')) NOT LIKE '%STOCK%'
          AND upper(coalesce(pc.listing_block_reason, '')) NOT LIKE '%AVAILABILITY NOT CONFIRMED%'
          AND upper(coalesce(pc.listing_block_reason, '')) NOT LIKE '%SUPPLIER_AVAILABILITY%'
          AND upper(coalesce(pc.listing_block_reason, '')) NOT LIKE '%SUPPLIER_LOW_STOCK%'
      )::int AS "stockKnown",
      count(*) FILTER (
        WHERE upper(coalesce(pc.listing_block_reason, '')) LIKE '%STALE_MARKETPLACE%'
           OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%STALE_SUPPLIER%'
      )::int AS "staleBlocked",
      count(*) FILTER (
        WHERE pc.decision_status = 'APPROVED'
          AND coalesce(pc.listing_eligible, false) = true
      )::int AS publishable,
      count(*) FILTER (WHERE pc.decision_status = 'MANUAL_REVIEW')::int AS "manualReview",
      count(*) FILTER (
        WHERE coalesce(pc.listing_block_reason, '') LIKE 'shipping intelligence unresolved:%'
           OR coalesce(pc.listing_block_reason, '') = 'MISSING_SHIPPING_INTELLIGENCE'
           OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%SHIPPING_SIGNAL_%'
      )::int AS "blockedByShipping",
      count(*) FILTER (
        WHERE upper(coalesce(pc.listing_block_reason, '')) LIKE '%PROFIT%'
           OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%MARGIN%'
           OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%ROI%'
      )::int AS "blockedByProfit",
      count(*) FILTER (
        WHERE upper(coalesce(pc.listing_block_reason, '')) LIKE '%LINKAGE%'
      )::int AS "blockedByLinkage"
    FROM profitable_candidates pc
    WHERE lower(pc.marketplace_key) = 'ebay'
  `);

  const totals = totalsResult.rows?.[0] ?? {
    totalCandidates: 0,
    shippingKnown: 0,
    stockKnown: 0,
    staleBlocked: 0,
    publishable: 0,
    manualReview: 0,
    blockedByShipping: 0,
    blockedByProfit: 0,
    blockedByLinkage: 0,
  };
  const totalCandidates = Math.max(0, Number(totals.totalCandidates ?? 0));
  const ratio = (value: number) => (totalCandidates > 0 ? value / totalCandidates : 0);

  return {
    supplierMix: (bySupplierResult.rows ?? []).map((row) => ({
      supplierKey: row.supplierKey,
      totalCandidates: Number(row.totalCandidates ?? 0),
      shippingBlocked: Number(row.shippingBlocked ?? 0),
      stockBlocked: Number(row.stockBlocked ?? 0),
      staleBlocked: Number(row.staleBlocked ?? 0),
      publishable: Number(row.publishable ?? 0),
      manualReview: Number(row.manualReview ?? 0),
      shareOfPool: ratio(Number(row.totalCandidates ?? 0)),
    })),
    shippingKnownRatio: ratio(Number(totals.shippingKnown ?? 0)),
    stockKnownRatio: ratio(Number(totals.stockKnown ?? 0)),
    staleRatio: ratio(Number(totals.staleBlocked ?? 0)),
    publishableRatio: ratio(Number(totals.publishable ?? 0)),
    manualReviewRatio: ratio(Number(totals.manualReview ?? 0)),
    blockedByShippingRatio: ratio(Number(totals.blockedByShipping ?? 0)),
    blockedByProfitRatio: ratio(Number(totals.blockedByProfit ?? 0)),
    blockedByLinkageRatio: ratio(Number(totals.blockedByLinkage ?? 0)),
  };
}

async function getStaleSupplierTargets(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const targets = await getMatchedSupplierRefreshTargets({ limit: safeLimit });
  const result = await db.execute<{ supplierKey: string; supplierProductId: string }>(sql`
    WITH latest_products AS (
      SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
        lower(pr.supplier_key) AS supplier_key,
        pr.supplier_product_id,
        pr.snapshot_ts
      FROM products_raw pr
      ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
    )
    SELECT lp.supplier_key AS "supplierKey", lp.supplier_product_id AS "supplierProductId"
    FROM latest_products lp
    INNER JOIN profitable_candidates pc
      ON lower(pc.supplier_key) = lp.supplier_key
     AND pc.supplier_product_id = lp.supplier_product_id
    WHERE lower(pc.marketplace_key) = 'ebay'
      AND (
        lp.snapshot_ts < NOW() - INTERVAL '48 hours'
        OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%STALE_SUPPLIER%'
        OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%SUPPLIER EVIDENCE%'
      )
    GROUP BY 1, 2
    LIMIT ${safeLimit}
  `);
  const keys = new Set((result.rows ?? []).map((row) => `${row.supplierKey}:${row.supplierProductId}`));
  return targets.filter((row) => keys.has(`${row.supplierKey}:${row.supplierProductId}`)).slice(0, safeLimit);
}

async function getStaleMarketplaceCandidates(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const result = await db.execute<{
    candidateId: string;
    supplierKey: string;
    supplierProductId: string;
    productRawId: string | null;
    marketplaceListingId: string;
  }>(sql`
    WITH latest_products AS (
      SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
        lower(pr.supplier_key) AS supplier_key,
        pr.supplier_product_id,
        pr.id::text AS product_raw_id
      FROM products_raw pr
      ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
    )
    SELECT
      pc.id::text AS "candidateId",
      lower(pc.supplier_key) AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      lp.product_raw_id AS "productRawId",
      pc.marketplace_listing_id AS "marketplaceListingId"
    FROM profitable_candidates pc
    LEFT JOIN latest_products lp
      ON lp.supplier_key = lower(pc.supplier_key)
     AND lp.supplier_product_id = pc.supplier_product_id
    WHERE lower(pc.marketplace_key) = 'ebay'
      AND pc.listing_block_reason LIKE 'marketplace snapshot age %'
    ORDER BY pc.calc_ts DESC NULLS LAST, pc.id DESC
    LIMIT ${safeLimit}
  `);
  return result.rows ?? [];
}

export async function buildOperationalSummary(runtime: RuntimeDiagnostics): Promise<AutonomousOpsSummary> {
  const [pipeline, blockReasons, integrity, shippingBlocked, supplierReliability, supplierRefreshTelemetry, candidateUniverse, marketplaceReliability, publishStats, manualQueue, repeatGrowth] =
    await Promise.all([
      getPipelineCounts(),
      getBlockedReasonDistribution(),
      getListingIntegritySummary(),
      findShippingBlockedCandidates(500),
      db.execute<{ supplierKey: string; candidates: number; shippingBlocked: number; supplierBlocked: number }>(sql`
        SELECT
          lower(pc.supplier_key) AS "supplierKey",
          count(*)::int AS candidates,
          count(*) FILTER (
            WHERE coalesce(pc.listing_block_reason, '') LIKE 'shipping intelligence unresolved:%'
               OR coalesce(pc.listing_block_reason, '') = 'MISSING_SHIPPING_INTELLIGENCE'
          )::int AS "shippingBlocked",
          count(*) FILTER (
            WHERE upper(coalesce(pc.listing_block_reason, '')) LIKE '%SUPPLIER%'
               OR upper(coalesce(pc.listing_block_reason, '')) LIKE '%STOCK%'
          )::int AS "supplierBlocked"
        FROM profitable_candidates pc
        WHERE lower(pc.marketplace_key) = 'ebay'
        GROUP BY 1
        ORDER BY candidates DESC, "supplierKey" ASC
      `),
      getSupplierRefreshTelemetry(),
      getCandidateUniverseScorecard(),
      db.execute<{ staleMarketplaceCandidates: number; freshMarketplaceRows24h: number; staleMarketplaceRows24h: number }>(sql`
        SELECT
          (
            SELECT count(*)::int
            FROM profitable_candidates pc
            WHERE lower(pc.marketplace_key) = 'ebay'
              AND pc.listing_block_reason LIKE 'marketplace snapshot age %'
          ) AS "staleMarketplaceCandidates",
          count(*) FILTER (WHERE snapshot_ts >= NOW() - INTERVAL '24 hours')::int AS "freshMarketplaceRows24h",
          count(*) FILTER (WHERE snapshot_ts < NOW() - INTERVAL '24 hours')::int AS "staleMarketplaceRows24h"
        FROM marketplace_prices
        WHERE lower(marketplace_key) = 'ebay'
      `),
      db.execute<{ failed24h: number; activeListings: number }>(sql`
        SELECT
          count(*) FILTER (
            WHERE status = 'PUBLISH_FAILED'
              AND updated_at >= NOW() - INTERVAL '24 hours'
              AND COALESCE(response ->> 'recoveryState', '') NOT IN (
                'BLOCKED_ORPHANED_PREVIEW',
                'BLOCKED_ORPHANED_CANDIDATE',
                'BLOCKED_STALE_PUBLISH_IN_PROGRESS',
                'BLOCKED_BROKEN_LINEAGE',
                'BLOCKED_ORPHANED_ACTIVE'
              )
              AND COALESCE(last_publish_error, '') NOT ILIKE 'Detached PREVIEW row removed from active review path by autonomous integrity healing.%'
              AND COALESCE(last_publish_error, '') NOT ILIKE 'detached preview: candidate missing%'
              AND COALESCE(last_publish_error, '') NOT ILIKE 'Listing blocked: candidate/listing supplier lineage mismatch%'
          )::int AS "failed24h",
          count(*) FILTER (WHERE status = 'ACTIVE')::int AS "activeListings"
        FROM listings
        WHERE lower(marketplace_key) = 'ebay'
      `),
      db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
        FROM orders
        WHERE upper(status) IN ('READY_FOR_PURCHASE_REVIEW', 'PURCHASE_APPROVED', 'PURCHASE_PENDING')
      `),
      db.execute<{ repeatCustomers: number; newRepeatCustomers30d: number }>(sql`
        SELECT
          count(*) FILTER (WHERE order_count >= 2)::int AS "repeatCustomers",
          count(*) FILTER (
            WHERE order_count >= 2
              AND first_order_at >= NOW() - INTERVAL '30 days'
          )::int AS "newRepeatCustomers30d"
        FROM customers
        WHERE lower(marketplace) = 'ebay'
      `),
    ]);

  const telemetryBySupplier = new Map(
    supplierRefreshTelemetry.map((row) => [row.supplierKey, row] as const)
  );

  return {
    runtime: {
      dotenvPath: runtime.dotenvPath,
      envSource: runtime.envSource,
      dbTargetClassification: runtime.dbTargetClassification,
      hasEbayClientId: runtime.hasEbayClientId,
      hasEbayClientSecret: runtime.hasEbayClientSecret,
    },
    pipeline,
    blockReasons,
    integrity,
    shippingBlocks: shippingBlocked.length,
    supplierReliability: (supplierReliability.rows ?? []).map((row) => {
      const telemetry = telemetryBySupplier.get(String(row.supplierKey ?? "").trim().toLowerCase());
      return {
        supplierKey: row.supplierKey,
        candidates: row.candidates,
        shippingBlocked: row.shippingBlocked,
        supplierBlocked: row.supplierBlocked,
        refreshSuccessRate: telemetry?.refreshSuccessRate ?? null,
        exactMatches: telemetry?.exactMatches ?? 0,
        refreshAttempts: telemetry?.attempts ?? 0,
        rateLimitEvents: telemetry?.rateLimitEvents ?? 0,
        exactMatchMisses: telemetry?.exactMatchMisses ?? 0,
      };
    }),
    candidateUniverse,
    marketplaceReliability:
      marketplaceReliability.rows?.[0] ?? {
        staleMarketplaceCandidates: 0,
        freshMarketplaceRows24h: 0,
        staleMarketplaceRows24h: 0,
      },
    publish:
      publishStats.rows?.[0] ?? {
        failed24h: 0,
        activeListings: 0,
      },
    manualPurchaseQueueCount: Number(manualQueue.rows?.[0]?.count ?? 0),
    repeatCustomerGrowth:
      repeatGrowth.rows?.[0] ?? {
        repeatCustomers: 0,
        newRepeatCustomers30d: 0,
      },
  };
}

export async function computePauseMap(runtime: RuntimeDiagnostics, summary: AutonomousOpsSummary) {
  const pauses = new Map<StageKey, string>();
  const learningHub = await getLearningHubScorecard();
  const publishFailureSpike = Number(summary.publish.failed24h ?? 0) >= Number(process.env.AUTONOMOUS_PUBLISH_FAILURE_SPIKE_THRESHOLD ?? 3);
  const staleSpike =
    Number(summary.marketplaceReliability.staleMarketplaceCandidates ?? 0) >=
    Number(process.env.AUTONOMOUS_STALE_DATA_SPIKE_THRESHOLD ?? 10);
  const integritySpike =
    Number(summary.integrity.orphanReadyToPublishCount ?? 0) +
      Number(summary.integrity.detachedPreviewCount ?? 0) +
      Number(summary.integrity.orphanActiveCount ?? 0) +
      Number(summary.integrity.brokenLineageCount ?? 0) >=
    Number(process.env.AUTONOMOUS_INTEGRITY_SPIKE_THRESHOLD ?? 5);
  const shippingUnknownSpike =
    Number(summary.shippingBlocks ?? 0) >= Number(process.env.AUTONOMOUS_SHIPPING_UNKNOWN_THRESHOLD ?? 5);
  const stockUnknownSpike = summary.blockReasons.some(
    (row) =>
      /stock|availability unknown|supplier evidence/i.test(row.reason) &&
      Number(row.count) >= Number(process.env.AUTONOMOUS_STOCK_UNKNOWN_THRESHOLD ?? 3)
  );

  if (!runtime.hasEbayClientId || !runtime.hasEbayClientSecret) {
    pauses.set("marketplace_refresh", "MARKETPLACE_RUNTIME_MISSING_EBAY_CREDS");
    pauses.set("guarded_publish_execution", "MARKETPLACE_RUNTIME_MISSING_EBAY_CREDS");
  }
  if (integritySpike) {
    pauses.set("listing_prepare", "INTEGRITY_SPIKE");
    pauses.set("publish_ready_promotion", "INTEGRITY_SPIKE");
    pauses.set("guarded_publish_execution", "INTEGRITY_SPIKE");
  }
  if (publishFailureSpike) pauses.set("guarded_publish_execution", "PUBLISH_FAILURE_SPIKE");
  if (staleSpike) pauses.set("guarded_publish_execution", "STALE_DATA_SPIKE");
  if (shippingUnknownSpike) pauses.set("guarded_publish_execution", "SHIPPING_UNKNOWN_SPIKE");
  if (stockUnknownSpike) pauses.set("guarded_publish_execution", "STOCK_UNKNOWN_SPIKE");
  if (Number(learningHub?.openDrift.critical ?? 0) > 0) {
    pauses.set("listing_prepare", "LEARNING_HUB_CRITICAL_DRIFT");
    pauses.set("guarded_publish_execution", "LEARNING_HUB_CRITICAL_DRIFT");
  }
  for (const reason of learningHub?.freshness.autonomyPauseReasons ?? []) {
    pauses.set("match_recompute", reason);
    pauses.set("profit_recompute", reason);
    pauses.set("listing_prepare", reason);
    pauses.set("guarded_publish_execution", reason);
  }

  return pauses;
}

async function runMarketplaceRecovery(limit: number) {
  const targets = await getStaleMarketplaceCandidates(limit);
  const productRawIds = new Set<string>();
  const supplierProducts = new Set<string>();
  let refreshed = 0;
  let queryErrors = 0;

  for (const target of targets) {
    if (!target.productRawId) continue;
    const scan = await handleMarketplaceScanJob({
      limit: 25,
      productRawId: target.productRawId,
      platform: "ebay",
    });
    const match = await handleMatchProductsJob({
      limit: 25,
      productRawId: target.productRawId,
    });
    await runProfitEngine({
      limit: 50,
      supplierKey: target.supplierKey,
      supplierProductId: target.supplierProductId,
    });
    productRawIds.add(target.productRawId);
    supplierProducts.add(`${target.supplierKey}:${target.supplierProductId}`);
    refreshed += Number(scan.upserted ?? 0) > 0 ? 1 : 0;
    queryErrors += Number(scan.queryErrors ?? 0);
    if (Number(match.scanned ?? 0) >= 0) {
      // noop: recompute is intentional here; tracked later via counts
    }
  }

  return {
    targets,
    refreshed,
    queryErrors,
    productRawIds: Array.from(productRawIds),
    supplierProducts: Array.from(supplierProducts),
  };
}

async function recomputeForTargets(input: {
  productRawIds: string[];
  supplierProducts: string[];
}) {
  let matched = 0;
  let profitUpdated = 0;

  for (const productRawId of input.productRawIds) {
    const result = await handleMatchProductsJob({ limit: 25, productRawId });
    matched += Number(result.active ?? 0) + Number(result.updated ?? 0) + Number(result.inserted ?? 0);
  }

  for (const key of input.supplierProducts) {
    const [supplierKey, supplierProductId] = key.split(":");
    const result = await runProfitEngine({
      limit: 50,
      supplierKey,
      supplierProductId,
    });
    profitUpdated += Number(result.insertedOrUpdated ?? 0);
  }

  return { matched, profitUpdated };
}

async function recordRunAudit(actorId: string, actorType: ActorType, result: AutonomousOpsRunResult) {
  await writeAuditLog({
    actorType,
    actorId,
    entityType: "SYSTEM",
    entityId: `autonomous-ops:${result.phase}`,
    eventType: "AUTONOMOUS_OPS_BACKBONE_COMPLETED",
    details: result,
  });
}

export async function runAutonomousOperations(input?: {
  phase?: AutonomousOpsPhase;
  actorId?: string;
  actorType?: ActorType;
  supplierRefreshLimit?: number;
  marketplaceRefreshLimit?: number;
  shippingLimit?: number;
  prepareLimit?: number;
  publishLimit?: number;
}): Promise<AutonomousOpsRunResult> {
  const phase = input?.phase ?? "full";
  const actorId = input?.actorId ?? "runAutonomousOperations";
  const actorType = normalizeActorType(input?.actorType);
  const stages: AutonomousOpsStageResult[] = [];
  const generatedAt = new Date().toISOString();
  let runtime: RuntimeDiagnostics = {
    dotenvPath: "",
    envSource: null,
    dbTargetClassification: null,
    hasEbayClientId: false,
    hasEbayClientSecret: false,
  };
  try {
    runtime = await getRuntimeDiagnostics();
  } catch (error) {
    stages.push({
      key: "runtime_diagnostics",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      counts: {
        hasEbayClientId: false,
        hasEbayClientSecret: false,
        dbTargetClassification: null,
      },
      details: toStageErrorDetails(error),
    });
  }
  if (!stages.find((stage) => stage.key === "runtime_diagnostics")) {
  stages.push({
    key: "runtime_diagnostics",
    status: stageIncluded(phase, "runtime_diagnostics") ? "completed" : "skipped",
    reasonCode: stageIncluded(phase, "runtime_diagnostics") ? null : "PHASE_SKIPPED",
    counts: {
      hasEbayClientId: runtime.hasEbayClientId,
      hasEbayClientSecret: runtime.hasEbayClientSecret,
      dbTargetClassification: runtime.dbTargetClassification,
    },
    details: runtime,
  });
  }

  let integrityBefore = {
    orphanReadyToPublishCount: 0,
    detachedPreviewCount: 0,
    orphanActiveCount: 0,
    stalePublishInProgressCount: 0,
    brokenLineageCount: 0,
  };
  try {
    integrityBefore = await getListingIntegritySummary();
    stages.push({
      key: "integrity_scan",
      status: stageIncluded(phase, "integrity_scan") ? "completed" : "skipped",
      reasonCode: stageIncluded(phase, "integrity_scan") ? null : "PHASE_SKIPPED",
      counts: integrityBefore,
      details: integrityBefore,
    });
  } catch (error) {
    stages.push({
      key: "integrity_scan",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      counts: integrityBefore,
      details: toStageErrorDetails(error),
    });
  }

  let initialSummary: AutonomousOpsSummary;
  try {
    initialSummary = await buildOperationalSummary(runtime);
  } catch {
    initialSummary = {
      runtime: {
        dotenvPath: runtime.dotenvPath,
        envSource: runtime.envSource,
        dbTargetClassification: runtime.dbTargetClassification,
        hasEbayClientId: runtime.hasEbayClientId,
        hasEbayClientSecret: runtime.hasEbayClientSecret,
      },
      pipeline: {
        approved: 0,
        manualReview: 0,
        readyToPublish: 0,
        preview: 0,
        active: 0,
        publishFailed: 0,
      },
      blockReasons: [],
      integrity: integrityBefore,
      shippingBlocks: 0,
      supplierReliability: [],
      candidateUniverse: {
        supplierMix: [],
        shippingKnownRatio: 0,
        stockKnownRatio: 0,
        staleRatio: 0,
        publishableRatio: 0,
        manualReviewRatio: 0,
        blockedByShippingRatio: 0,
        blockedByProfitRatio: 0,
        blockedByLinkageRatio: 0,
      },
      marketplaceReliability: {
        staleMarketplaceCandidates: 0,
        freshMarketplaceRows24h: 0,
        staleMarketplaceRows24h: 0,
      },
      publish: {
        failed24h: 0,
        activeListings: 0,
      },
      manualPurchaseQueueCount: 0,
      repeatCustomerGrowth: {
        repeatCustomers: 0,
        newRepeatCustomers30d: 0,
      },
    };
  }
  let pauseMap = await computePauseMap(runtime, initialSummary);
  const refreshProductRawIds = new Set<string>();
  const refreshSupplierProducts = new Set<string>();

  async function refreshPauseMap() {
    try {
      const summary = await buildOperationalSummary(runtime);
      pauseMap = await computePauseMap(runtime, summary);
    } catch {
      // Keep the previous pause map if the summary cannot be refreshed.
    }
  }

  if (stageIncluded(phase, "integrity_heal")) {
    try {
      const heal = await healListingIntegrity({
        actorId,
        actorType,
        limitPerClass: 50,
      });
      stages.push({
        key: "integrity_heal",
        status: "completed",
        reasonCode: null,
        counts: {
          orphanReadyToPublishClosed: heal.orphanReadyToPublishClosed.length,
          detachedPreviewsArchived: heal.detachedPreviewsArchived.length,
          orphanActivePaused: heal.orphanActivePaused.length,
          stalePublishInProgressFailed: heal.stalePublishInProgressFailed.length,
          brokenLineageContained: heal.brokenLineageContained.length,
        },
        details: heal,
      });
      await refreshPauseMap();
    } catch (error) {
      stages.push({
        key: "integrity_heal",
        status: "failed",
        reasonCode: toStageErrorCode(error),
        counts: {},
        details: toStageErrorDetails(error),
      });
    }
  }

  if (stageIncluded(phase, "supplier_refresh")) {
    if (pauseMap.has("supplier_refresh")) {
      stages.push({
        key: "supplier_refresh",
        status: "paused",
        reasonCode: pauseMap.get("supplier_refresh") ?? "PAUSED",
        counts: { targeted: 0, refreshed: 0 },
      });
    } else {
      try {
        const targets = await getStaleSupplierTargets(input?.supplierRefreshLimit ?? 10);
        const outcomes = [];
        for (const target of targets) {
          const result = await refreshMatchedSupplierRows({
            supplierKey: target.supplierKey,
            supplierProductId: target.supplierProductId,
            limit: 1,
          });
          outcomes.push(result);
          for (const outcome of result.outcomes) {
            if (outcome.refresh.refreshedSnapshotId) refreshProductRawIds.add(outcome.refresh.refreshedSnapshotId);
            refreshSupplierProducts.add(`${outcome.target.supplierKey}:${outcome.target.supplierProductId}`);
          }
        }
        stages.push({
          key: "supplier_refresh",
          status: "completed",
          reasonCode: null,
          counts: {
            targeted: targets.length,
            refreshed: outcomes.reduce(
              (sum, entry) =>
                sum +
                entry.outcomes.filter((outcome) => Boolean(outcome.refresh.refreshed)).length,
              0
            ),
          },
          details: outcomes,
        });
      } catch (error) {
        stages.push({
          key: "supplier_refresh",
          status: "failed",
          reasonCode: toStageErrorCode(error),
          counts: {},
          details: toStageErrorDetails(error),
        });
      }
    }
  }

  if (stageIncluded(phase, "marketplace_refresh")) {
    if (pauseMap.has("marketplace_refresh")) {
      stages.push({
        key: "marketplace_refresh",
        status: "paused",
        reasonCode: pauseMap.get("marketplace_refresh") ?? "PAUSED",
        counts: { targeted: 0, refreshed: 0, queryErrors: 0 },
      });
    } else {
      try {
        const result = await runMarketplaceRecovery(input?.marketplaceRefreshLimit ?? 15);
        result.productRawIds.forEach((id) => refreshProductRawIds.add(id));
        result.supplierProducts.forEach((id) => refreshSupplierProducts.add(id));
        stages.push({
          key: "marketplace_refresh",
          status: "completed",
          reasonCode: null,
          counts: {
            targeted: result.targets.length,
            refreshed: result.refreshed,
            queryErrors: result.queryErrors,
          },
          details: result.targets,
        });
      } catch (error) {
        stages.push({
          key: "marketplace_refresh",
          status: "failed",
          reasonCode: toStageErrorCode(error),
          counts: {},
          details: toStageErrorDetails(error),
        });
      }
    }
  }

  if (stageIncluded(phase, "shipping_refresh")) {
    if (pauseMap.has("shipping_refresh")) {
      stages.push({
        key: "shipping_refresh",
        status: "paused",
        reasonCode: pauseMap.get("shipping_refresh") ?? "PAUSED",
        counts: { scanned: 0, persistedQuotes: 0, stillBlocked: 0 },
      });
    } else {
      try {
        const result = await automateShippingIntelligence({
          limit: input?.shippingLimit ?? 50,
          actorId,
          actorType,
        });
        stages.push({
          key: "shipping_refresh",
          status: "completed",
          reasonCode: null,
          counts: {
            scanned: result.scanned,
            persistedQuotes: result.persistedQuotes,
            recomputedCandidates: result.recomputedCandidates,
            stillBlocked: result.stillBlocked,
          },
          details: result,
        });
      } catch (error) {
        stages.push({
          key: "shipping_refresh",
          status: "failed",
          reasonCode: toStageErrorCode(error),
          counts: {},
          details: toStageErrorDetails(error),
        });
      }
    }
  }

  if (stageIncluded(phase, "match_recompute")) {
    try {
      const result = await recomputeForTargets({
        productRawIds: Array.from(refreshProductRawIds),
        supplierProducts: Array.from(refreshSupplierProducts),
      });
      stages.push({
        key: "match_recompute",
        status: "completed",
        reasonCode: null,
        counts: { matched: result.matched, targetedSnapshots: refreshProductRawIds.size },
        details: result,
      });
      stages.push({
        key: "profit_recompute",
        status: stageIncluded(phase, "profit_recompute") ? "completed" : "skipped",
        reasonCode: stageIncluded(phase, "profit_recompute") ? null : "PHASE_SKIPPED",
        counts: { updated: result.profitUpdated, targetedSupplierProducts: refreshSupplierProducts.size },
        details: result,
      });
    } catch (error) {
      stages.push({
        key: "match_recompute",
        status: "failed",
        reasonCode: toStageErrorCode(error),
        counts: {},
        details: toStageErrorDetails(error),
      });
      if (stageIncluded(phase, "profit_recompute")) {
        stages.push({
          key: "profit_recompute",
          status: "failed",
          reasonCode: toStageErrorCode(error),
          counts: {},
          details: toStageErrorDetails(error),
        });
      }
    }
  } else if (stageIncluded(phase, "profit_recompute")) {
    stages.push({
      key: "profit_recompute",
      status: "completed",
      reasonCode: null,
      counts: { updated: 0, targetedSupplierProducts: 0 },
      details: null,
    });
  }

  await refreshPauseMap();

  if (stageIncluded(phase, "listing_prepare")) {
    if (pauseMap.has("listing_prepare")) {
      stages.push({
        key: "listing_prepare",
        status: "paused",
        reasonCode: pauseMap.get("listing_prepare") ?? "PAUSED",
        counts: { scanned: 0, created: 0, updated: 0, ready: 0 },
      });
    } else {
      try {
        const result = await prepareListingPreviews({
          limit: input?.prepareLimit ?? 25,
          marketplace: "ebay",
          forceRefresh: true,
        });
        stages.push({
          key: "listing_prepare",
          status: "completed",
          reasonCode: null,
          counts: {
            scanned: Number(result.scanned ?? 0),
            created: Number(result.created ?? 0),
            updated: Number(result.updated ?? 0),
            ready: Number(result.ready ?? 0),
          },
          details: result,
        });
      } catch (error) {
        stages.push({
          key: "listing_prepare",
          status: "failed",
          reasonCode: toStageErrorCode(error),
          counts: {},
          details: toStageErrorDetails(error),
        });
      }
    }
  }

  if (stageIncluded(phase, "publish_ready_promotion")) {
    if (pauseMap.has("publish_ready_promotion")) {
      stages.push({
        key: "publish_ready_promotion",
        status: "paused",
        reasonCode: pauseMap.get("publish_ready_promotion") ?? "PAUSED",
        counts: { scanned: 0, promoted: 0, blocked: 0 },
      });
    } else {
      try {
        const result = await promoteApprovedPreviewsToReady({
          limit: input?.prepareLimit ?? 25,
          actorId,
          actorType,
        });
        stages.push({
          key: "publish_ready_promotion",
          status: "completed",
          reasonCode: null,
          counts: {
            scanned: result.scanned,
            promoted: result.promoted,
            blocked: result.blocked,
          },
          details: result.results,
        });
      } catch (error) {
        stages.push({
          key: "publish_ready_promotion",
          status: "failed",
          reasonCode: toStageErrorCode(error),
          counts: {},
          details: toStageErrorDetails(error),
        });
      }
    }
  }

  if (stageIncluded(phase, "guarded_publish_execution")) {
    const brokenLineage = await listBrokenLineageListings();
    if (pauseMap.has("guarded_publish_execution")) {
      stages.push({
        key: "guarded_publish_execution",
        status: "paused",
        reasonCode: pauseMap.get("guarded_publish_execution") ?? "PAUSED",
        counts: { executed: 0, skipped: 0, failed: 0 },
      });
    } else if (brokenLineage.length > 0) {
      stages.push({
        key: "guarded_publish_execution",
        status: "paused",
        reasonCode: "BROKEN_LINEAGE_PRESENT",
        counts: { executed: 0, skipped: 0, failed: 0, brokenLineageCount: brokenLineage.length },
      });
    } else {
      try {
        const result = await runListingExecution({
          limit: input?.publishLimit ?? 3,
          marketplaceKey: "ebay",
          dryRun: String(process.env.ENABLE_EBAY_LIVE_PUBLISH ?? "false").trim().toLowerCase() !== "true",
          actorId,
        });
        stages.push({
          key: "guarded_publish_execution",
          status: "completed",
          reasonCode: null,
          counts: {
            executed: Number(result.executed ?? 0),
            skipped: Number(result.skipped ?? 0),
            failed: Number(result.failed ?? 0),
          },
          details: result,
        });
      } catch (error) {
        stages.push({
          key: "guarded_publish_execution",
          status: "failed",
          reasonCode: toStageErrorCode(error),
          counts: {},
          details: toStageErrorDetails(error),
        });
      }
    }
  }

  let finalSummary = initialSummary;
  try {
    const learningRefresh = await runContinuousLearningRefresh({
      trigger: `backbone:${phase}`,
      forceFull: true,
    });
    finalSummary = await buildOperationalSummary(runtime);
    await recordOperationalSummaryLearning({
      shippingBlocks: finalSummary.shippingBlocks,
      manualPurchaseQueueCount: finalSummary.manualPurchaseQueueCount,
      publishableRatio: finalSummary.candidateUniverse.publishableRatio,
      manualReviewRatio: finalSummary.candidateUniverse.manualReviewRatio,
      blockedByShippingRatio: finalSummary.candidateUniverse.blockedByShippingRatio,
      blockedByProfitRatio: finalSummary.candidateUniverse.blockedByProfitRatio,
      blockedByLinkageRatio: finalSummary.candidateUniverse.blockedByLinkageRatio,
      supplierMix: finalSummary.candidateUniverse.supplierMix,
    });
    stages.push({
      key: "health_summary",
      status: stageIncluded(phase, "health_summary") ? "completed" : "skipped",
      reasonCode: stageIncluded(phase, "health_summary") ? null : "PHASE_SKIPPED",
      counts: {
        approved: finalSummary.pipeline.approved,
        manualReview: finalSummary.pipeline.manualReview,
        readyToPublish: finalSummary.pipeline.readyToPublish,
        active: finalSummary.pipeline.active,
        shippingBlocks: finalSummary.shippingBlocks,
        manualPurchaseQueueCount: finalSummary.manualPurchaseQueueCount,
        learningStagesCompleted: learningRefresh.stages.filter((stage) => stage.status === "completed").length,
        learningFreshnessErrors: learningRefresh.freshness.staleDomainCount,
      },
      details: {
        ...finalSummary,
        learningRefresh,
      },
    });
  } catch (error) {
    stages.push({
      key: "health_summary",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      counts: {},
      details: toStageErrorDetails(error),
    });
  }

  const result: AutonomousOpsRunResult = {
    ok: !stages.some((stage) => stage.status === "failed"),
    phase,
    actorId,
    generatedAt,
    pauses: Array.from(pauseMap.entries()).map(([stage, reason]) => ({ stage, reason })),
    stages,
    summary: finalSummary,
  };

  await recordRunAudit(actorId, actorType, result);
  return result;
}
