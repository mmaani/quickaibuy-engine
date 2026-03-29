import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  buildOperationalSummary,
  computePauseMap,
  getRuntimeDiagnostics,
  runAutonomousOperations,
  type AutonomousOpsRunResult,
  type AutonomousOpsSummary,
  type RuntimeDiagnostics,
} from "@/lib/autonomousOps/backbone";
import { getListingIntegritySummary } from "@/lib/listings/integrity";
import { runSupplierDiscover } from "@/lib/jobs/supplierDiscover";
import { handleMarketplaceScanJob } from "@/lib/jobs/marketplaceScan";
import { handleMatchProductsJob } from "@/lib/jobs/matchProducts";
import { automateShippingIntelligence } from "@/lib/pricing/shippingAutomation";
import { refreshMatchedSupplierRows } from "@/lib/products/refreshMatchedSupplierRows";
import { runProfitEngine } from "@/lib/profit/profitEngine";
import { classifyRuntimeFailure } from "@/lib/operations/runtimeFailure";

type ActorType = "ADMIN" | "WORKER" | "SYSTEM";

export type FullCycleStageKey =
  | "runtime_diagnostics"
  | "live_state_integrity"
  | "autonomous_diagnostics_refresh"
  | "supplier_wave_refresh"
  | "marketplace_refresh"
  | "shipping_recovery"
  | "candidate_recompute"
  | "prepare_stage"
  | "publish_ready_promotion"
  | "guarded_publish_stage"
  | "final_summary";

export type FullCycleStageResult = {
  key: FullCycleStageKey;
  status: "completed" | "failed" | "paused";
  reasonCode: string | null;
  failureClass?: "infrastructure" | "safety" | "business_data" | "unknown" | null;
  counts: Record<string, number | string | boolean | null>;
  details?: unknown;
};

export type FullCycleRunResult = {
  ok: boolean;
  command: "pnpm ops:full-cycle";
  generatedAt: string;
  operatingBranch: "main";
  actorId: string;
  runtime: RuntimeDiagnostics;
  safeToRunNow: boolean;
  manualStep: "Supplier purchase only";
  pauses: Array<{ stage: string; reason: string }>;
  stages: FullCycleStageResult[];
  summary: AutonomousOpsSummary;
  audit: {
    status: "completed" | "failed";
    reasonCode: string | null;
  };
};

type RecentSupplierProduct = {
  productRawId: string;
  supplierKey: string;
  supplierProductId: string;
};

function toStageErrorCode(error: unknown): string {
  return classifyRuntimeFailure(error).reasonCode;
}

function toStageErrorDetails(error: unknown) {
  const classified = classifyRuntimeFailure(error);
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ?? null,
      failure: classified,
    };
  }
  return { message: String(error), stack: null, failure: classified };
}

function getAutonomousStage(result: AutonomousOpsRunResult, key: string) {
  return result.stages.find((stage) => stage.key === key) ?? null;
}

async function getRecentPreferredSupplierProducts(input: {
  startedAtIso: string;
  suppliers: string[];
  limit: number;
}): Promise<RecentSupplierProduct[]> {
  const suppliers = input.suppliers.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!suppliers.length) return [];
  const supplierSqlList = sql.join(suppliers.map((supplier) => sql`${supplier}`), sql`, `);

  const result = await db.execute<RecentSupplierProduct>(sql`
    WITH latest_products AS (
      SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
        pr.id::text AS "productRawId",
        lower(pr.supplier_key) AS "supplierKey",
        pr.supplier_product_id AS "supplierProductId",
        pr.snapshot_ts
      FROM products_raw pr
      WHERE pr.snapshot_ts >= ${input.startedAtIso}::timestamp
        AND lower(pr.supplier_key) IN (${supplierSqlList})
      ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
    )
    SELECT
      lp."productRawId",
      lp."supplierKey",
      lp."supplierProductId"
    FROM latest_products lp
    ORDER BY
      CASE
        WHEN lp."supplierKey" = 'cjdropshipping' THEN 0
        WHEN lp."supplierKey" = 'temu' THEN 1
        WHEN lp."supplierKey" = 'alibaba' THEN 2
        ELSE 3
      END,
      lp.snapshot_ts DESC NULLS LAST
    LIMIT ${Math.max(1, Math.min(input.limit, 400))}
  `);

  return result.rows ?? [];
}

async function recordFullCycleAudit(actorId: string, actorType: ActorType, result: FullCycleRunResult) {
  await writeAuditLog({
    actorType,
    actorId,
    entityType: "SYSTEM",
    entityId: "ops:full-cycle",
    eventType: "FULL_CYCLE_RUN_COMPLETED",
    details: result,
  });
}

export async function runCanonicalFullCycle(input?: {
  actorId?: string;
  actorType?: ActorType;
  supplierWaveLimitPerKeyword?: number;
  rebuildLimit?: number;
  refreshLimitPerSupplier?: number;
  shippingLimit?: number;
  prepareLimit?: number;
  publishLimit?: number;
}): Promise<FullCycleRunResult> {
  const generatedAt = new Date().toISOString();
  const actorId = input?.actorId ?? "runCanonicalFullCycle";
  const actorType = input?.actorType ?? "SYSTEM";
  const stages: FullCycleStageResult[] = [];
  const preferredSuppliers = ["cjdropshipping", "temu", "alibaba"];
  const supplierWaveLimitPerKeyword = Math.max(12, Math.min(Number(input?.supplierWaveLimitPerKeyword ?? 18), 60));
  const rebuildLimit = Math.max(20, Math.min(Number(input?.rebuildLimit ?? 120), 300));
  const refreshLimitPerSupplier = Math.max(5, Math.min(Number(input?.refreshLimitPerSupplier ?? 40), 120));

  let runtime: RuntimeDiagnostics = {
    dotenvPath: "",
    envSource: null,
    dbTargetClassification: null,
    hasEbayClientId: false,
    hasEbayClientSecret: false,
  };
  try {
    runtime = await getRuntimeDiagnostics();
    stages.push({
      key: "runtime_diagnostics",
      status: "completed",
      reasonCode: null,
      counts: {
        hasEbayClientId: runtime.hasEbayClientId,
        hasEbayClientSecret: runtime.hasEbayClientSecret,
        dbTargetClassification: runtime.dbTargetClassification,
        envSource: runtime.envSource,
      },
      details: runtime,
    });
  } catch (error) {
    stages.push({
      key: "runtime_diagnostics",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: {},
      details: toStageErrorDetails(error),
    });
  }

  let integrity = {
    orphanReadyToPublishCount: 0,
    detachedPreviewCount: 0,
    orphanActiveCount: 0,
    stalePublishInProgressCount: 0,
    brokenLineageCount: 0,
  };
  try {
    integrity = await getListingIntegritySummary();
    stages.push({
      key: "live_state_integrity",
      status: "completed",
      reasonCode: null,
      counts: integrity,
      details: integrity,
    });
  } catch (error) {
    stages.push({
      key: "live_state_integrity",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: integrity,
      details: toStageErrorDetails(error),
    });
  }

  let diagnosticsRefresh: AutonomousOpsRunResult | null = null;
  try {
    diagnosticsRefresh = await runAutonomousOperations({
      phase: "diagnostics_refresh",
      actorId,
      actorType,
    });
    stages.push({
      key: "autonomous_diagnostics_refresh",
      status: diagnosticsRefresh.ok ? "completed" : "failed",
      reasonCode: diagnosticsRefresh.ok ? null : "AUTONOMOUS_DIAGNOSTICS_REFRESH_FAILED",
      counts: {
        pauses: diagnosticsRefresh.pauses.length,
        shippingBlocks: diagnosticsRefresh.summary.shippingBlocks,
        readyToPublish: diagnosticsRefresh.summary.pipeline.readyToPublish,
      },
      details: diagnosticsRefresh,
    });
  } catch (error) {
    stages.push({
      key: "autonomous_diagnostics_refresh",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: {},
      details: toStageErrorDetails(error),
    });
  }

  const discoveryStartedAt = new Date().toISOString();
  let supplierWave = {
    processedCandidates: 0,
    insertedCount: 0,
    scannedProducts: 0,
    scoredProducts: 0,
    keywords: [] as string[],
    sources: [] as string[],
    sourceBreakdown: [] as Array<Record<string, unknown>>,
    sourcePlan: [] as Array<{ source: string; searchLimit: number }>,
  };
  const refreshBatches: Array<Awaited<ReturnType<typeof refreshMatchedSupplierRows>>> = [];
  try {
    supplierWave = await runSupplierDiscover(supplierWaveLimitPerKeyword);
    for (const supplierKey of preferredSuppliers) {
      refreshBatches.push(
        await refreshMatchedSupplierRows({
          supplierKey,
          limit: refreshLimitPerSupplier,
          searchLimit: 80,
        })
      );
    }
    stages.push({
      key: "supplier_wave_refresh",
      status: "completed",
      reasonCode: null,
      counts: {
        processedCandidates: supplierWave.processedCandidates,
        insertedCount: supplierWave.insertedCount,
        scannedProducts: supplierWave.scannedProducts,
        refreshTargets: refreshBatches.reduce((sum, batch) => sum + batch.targets.length, 0),
        refreshedOutcomes: refreshBatches.reduce(
          (sum, batch) => sum + batch.outcomes.filter((row) => row.refresh.refreshed || row.refresh.refreshedSnapshotId).length,
          0
        ),
      },
      details: {
        discovery: supplierWave,
        refreshBatches: refreshBatches.map((batch) => ({
          targets: batch.targets.length,
          outcomes: batch.outcomes.length,
        })),
      },
    });
  } catch (error) {
    stages.push({
      key: "supplier_wave_refresh",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: {
        processedCandidates: supplierWave.processedCandidates,
        insertedCount: supplierWave.insertedCount,
        scannedProducts: supplierWave.scannedProducts,
      },
      details: toStageErrorDetails(error),
    });
  }

  let recentProducts: RecentSupplierProduct[] = [];
  try {
    recentProducts = await getRecentPreferredSupplierProducts({
      startedAtIso: discoveryStartedAt,
      suppliers: preferredSuppliers,
      limit: rebuildLimit,
    });
  } catch {
    recentProducts = [];
  }

  let marketplaceUpserts = 0;
  let marketplaceQueryErrors = 0;
  try {
    for (const product of recentProducts) {
      const scan = await handleMarketplaceScanJob({
        limit: 25,
        productRawId: product.productRawId,
        platform: "ebay",
      });
      marketplaceUpserts += Number(scan.upserted ?? 0);
      marketplaceQueryErrors += Number(scan.queryErrors ?? 0);
    }
    stages.push({
      key: "marketplace_refresh",
      status: marketplaceQueryErrors > 0 ? "paused" : "completed",
      reasonCode: marketplaceQueryErrors > 0 ? "MARKETPLACE_QUERY_ERRORS_PRESENT" : null,
      counts: {
        recentProducts: recentProducts.length,
        marketplaceUpserts,
        marketplaceQueryErrors,
      },
      details: { recentProducts },
    });
  } catch (error) {
    stages.push({
      key: "marketplace_refresh",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: {
        recentProducts: recentProducts.length,
        marketplaceUpserts,
        marketplaceQueryErrors,
      },
      details: toStageErrorDetails(error),
    });
  }

  let shipping = {
    ok: false,
    scanned: 0,
    persistedQuotes: 0,
    recomputedCandidates: 0,
    stillBlocked: 0,
    exactRefreshAttempts: 0,
    exactRefreshRecovered: 0,
    alternateSupplierAttempts: 0,
    alternateSupplierRecovered: 0,
    bySupplier: [] as Array<Record<string, unknown>>,
    gapBreakdown: [] as Array<Record<string, unknown>>,
    persisted: [] as Array<Record<string, unknown>>,
  };
  try {
    shipping = await automateShippingIntelligence({
      limit: input?.shippingLimit ?? 200,
      actorId,
      actorType,
    });
    stages.push({
      key: "shipping_recovery",
      status: shipping.ok ? "completed" : "failed",
      reasonCode: shipping.ok ? null : "SHIPPING_RECOVERY_FAILED",
      counts: {
        scanned: shipping.scanned,
        persistedQuotes: shipping.persistedQuotes,
        stillBlocked: shipping.stillBlocked,
        exactRefreshRecovered: shipping.exactRefreshRecovered,
        alternateSupplierRecovered: shipping.alternateSupplierRecovered,
      },
      details: shipping,
    });
  } catch (error) {
    stages.push({
      key: "shipping_recovery",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: {
        scanned: 0,
        persistedQuotes: 0,
      },
      details: toStageErrorDetails(error),
    });
  }

  let matchedCount = 0;
  let profitUpdated = 0;
  try {
    for (const product of recentProducts) {
      const match = await handleMatchProductsJob({
        limit: 25,
        productRawId: product.productRawId,
      });
      matchedCount += Number(match.active ?? 0) + Number(match.updated ?? 0) + Number(match.inserted ?? 0);

      const profit = await runProfitEngine({
        limit: 50,
        supplierKey: product.supplierKey,
        supplierProductId: product.supplierProductId,
        marketplaceKey: "ebay",
      });
      profitUpdated += Number(profit.insertedOrUpdated ?? 0);
    }
    stages.push({
      key: "candidate_recompute",
      status: "completed",
      reasonCode: null,
      counts: {
        recentProducts: recentProducts.length,
        matchedCount,
        profitUpdated,
      },
    });
  } catch (error) {
    stages.push({
      key: "candidate_recompute",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: {
        recentProducts: recentProducts.length,
        matchedCount,
        profitUpdated,
      },
      details: toStageErrorDetails(error),
    });
  }

  let prepareRun: AutonomousOpsRunResult | null = null;
  try {
    prepareRun = await runAutonomousOperations({
      phase: "prepare",
      actorId,
      actorType,
      prepareLimit: input?.prepareLimit,
    });
    const prepareStage = getAutonomousStage(prepareRun, "listing_prepare");
    const promotionStage = getAutonomousStage(prepareRun, "publish_ready_promotion");
    stages.push({
      key: "prepare_stage",
      status: prepareStage?.status === "failed" ? "failed" : prepareStage?.status === "paused" ? "paused" : "completed",
      reasonCode: prepareStage?.reasonCode ?? null,
      counts: prepareStage?.counts ?? {},
      details: prepareStage ?? prepareRun,
    });
    stages.push({
      key: "publish_ready_promotion",
      status: promotionStage?.status === "failed" ? "failed" : promotionStage?.status === "paused" ? "paused" : "completed",
      reasonCode: promotionStage?.reasonCode ?? null,
      counts: promotionStage?.counts ?? {},
      details: promotionStage ?? prepareRun,
    });
  } catch (error) {
    stages.push({
      key: "prepare_stage",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: {},
      details: toStageErrorDetails(error),
    });
    stages.push({
      key: "publish_ready_promotion",
      status: "failed",
      reasonCode: "PREPARE_STAGE_FAILED",
      counts: {},
    });
  }

  let publishRun: AutonomousOpsRunResult | null = null;
  try {
    publishRun = await runAutonomousOperations({
      phase: "publish",
      actorId,
      actorType,
      publishLimit: input?.publishLimit,
    });
    const publishStage = getAutonomousStage(publishRun, "guarded_publish_execution");
    stages.push({
      key: "guarded_publish_stage",
      status: publishStage?.status === "failed" ? "failed" : publishStage?.status === "paused" ? "paused" : "completed",
      reasonCode: publishStage?.reasonCode ?? null,
      counts: publishStage?.counts ?? {},
      details: publishStage ?? publishRun,
    });
  } catch (error) {
    stages.push({
      key: "guarded_publish_stage",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: {},
      details: toStageErrorDetails(error),
    });
  }

  let summary: AutonomousOpsSummary;
  try {
    summary = await buildOperationalSummary(runtime);
  } catch {
    summary = {
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
      integrity,
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
  let pauseMap = new Map<string, string>();
  try {
    pauseMap = await computePauseMap(runtime, summary);
  } catch (error) {
    stages.push({
      key: "final_summary",
      status: "failed",
      reasonCode: toStageErrorCode(error),
      failureClass: classifyRuntimeFailure(error).class,
      counts: {},
      details: toStageErrorDetails(error),
    });
  }
  const safeToRunNow =
    runtime.hasEbayClientId &&
    runtime.hasEbayClientSecret &&
    pauseMap.size === 0 &&
    summary.integrity.orphanReadyToPublishCount === 0 &&
    summary.integrity.detachedPreviewCount === 0 &&
    summary.integrity.orphanActiveCount === 0 &&
    summary.integrity.brokenLineageCount === 0;

  stages.push({
    key: "final_summary",
    status: "completed",
    reasonCode: null,
    counts: {
      readyToPublish: summary.pipeline.readyToPublish,
      active: summary.pipeline.active,
      shippingBlocks: summary.shippingBlocks,
      manualPurchaseQueueCount: summary.manualPurchaseQueueCount,
      safeToRunNow,
    },
    details: summary,
  });

  const result: FullCycleRunResult = {
    ok: !stages.some((stage) => stage.status === "failed"),
    command: "pnpm ops:full-cycle",
    generatedAt,
    operatingBranch: "main",
    actorId,
    runtime,
    safeToRunNow,
    manualStep: "Supplier purchase only",
    pauses: Array.from(pauseMap.entries()).map(([stage, reason]) => ({ stage, reason })),
    stages,
    summary,
    audit: {
      status: "completed",
      reasonCode: null,
    },
  };

  try {
    await recordFullCycleAudit(actorId, actorType, result);
  } catch (error) {
    const failure = classifyRuntimeFailure(error);
    result.audit = {
      status: "failed",
      reasonCode: failure.reasonCode,
    };
    result.ok = false;
  }
  return result;
}
