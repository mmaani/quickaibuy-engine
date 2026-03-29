import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { recordMetricSnapshot, recordDriftEvent } from "@/lib/learningHub/drift";
import { recordEvalLabel } from "@/lib/learningHub/evals";
import { recordLearningEvidence, upsertLearningFeature } from "@/lib/learningHub/featureStore";
import type { EvidenceType } from "@/lib/learningHub/types";
import { canonicalSupplierKey } from "@/lib/suppliers/intelligence";

type StageEvidenceInput = {
  evidenceType: EvidenceType;
  entityType: string;
  entityId: string;
  supplierKey?: string | null;
  marketplaceKey?: string | null;
  source: string;
  parserVersion?: string | null;
  confidence?: number | null;
  freshnessSeconds?: number | null;
  blockedReasons?: Array<string | null | undefined>;
  downstreamOutcome?: string | null;
  diagnostics?: Record<string, unknown> | null;
};

type FeatureAggregate = {
  supplierKey: string;
  supplierReliability: number;
  shippingReliability: number;
  stockReliability: number;
  parserYield: number;
  publishability: number;
  failurePressure: number;
  sampleSize: number;
};

function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp01(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function normalizeBlockedReasons(input: Array<string | null | undefined> | undefined): string[] {
  return Array.from(
    new Set(
      (input ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
}

function inferConfidence(input: {
  ok?: boolean;
  ratio?: number | null;
  explicit?: number | null;
  blockedReasons?: string[];
}): number {
  if (input.explicit != null && Number.isFinite(input.explicit)) {
    return Math.max(0, Math.min(1, input.explicit));
  }
  if (input.ratio != null && Number.isFinite(input.ratio)) {
    const bounded = Math.max(0, Math.min(1, input.ratio));
    return input.ok === false ? Math.max(0.05, bounded * 0.6) : bounded;
  }
  if ((input.blockedReasons?.length ?? 0) > 0) return 0.42;
  if (input.ok === false) return 0.25;
  return 0.9;
}

async function writeStageEvidence(input: StageEvidenceInput) {
  return recordLearningEvidence({
    evidenceType: input.evidenceType,
    entityType: input.entityType,
    entityId: input.entityId,
    supplierKey: input.supplierKey ? canonicalSupplierKey(input.supplierKey) : null,
    marketplaceKey: input.marketplaceKey ?? null,
    source: input.source,
    parserVersion: input.parserVersion ?? "learning-hub:v2",
    confidence: input.confidence ?? null,
    freshnessSeconds: input.freshnessSeconds ?? null,
    validationStatus: "PASS",
    blockedReasons: normalizeBlockedReasons(input.blockedReasons),
    downstreamOutcome: input.downstreamOutcome ?? null,
    diagnostics: input.diagnostics ?? null,
    observedAt: new Date(),
  });
}

async function writeMetricWithDrift(input: {
  metricKey: string;
  metricValue: number;
  sampleSize?: number;
  category:
    | "payload_drift"
    | "missingness_drift"
    | "parser_yield_drift"
    | "supplier_instability"
    | "freshness_failure"
    | "shipping_ratio_regression"
    | "stock_ratio_regression"
    | "evidence_quality_degradation"
    | "candidate_pool_degradation";
  segmentKey?: string;
  metadata?: Record<string, unknown>;
}) {
  const segmentKey = input.segmentKey ?? "global";
  await recordMetricSnapshot({
    metricKey: input.metricKey,
    segmentKey,
    metricValue: input.metricValue,
    sampleSize: input.sampleSize ?? 0,
    metadata: input.metadata ?? undefined,
  });

  const baselineResult = await db.execute<{ metricValue: number }>(sql`
    SELECT metric_value AS "metricValue"
    FROM learning_metric_snapshots
    WHERE metric_key = ${input.metricKey}
      AND segment_key = ${segmentKey}
      AND snapshot_ts < now() - interval '1 minute'
    ORDER BY snapshot_ts DESC
    LIMIT 1
  `);
  const baseline = toNullableNumber(baselineResult.rows?.[0]?.metricValue);
  if (baseline == null) return null;

  return recordDriftEvent({
    metricKey: input.metricKey,
    segmentKey,
    category: input.category,
    baselineValue: baseline,
    observedValue: input.metricValue,
    sampleSize: input.sampleSize ?? 0,
  });
}

export async function recordSupplierRefreshLearning(input: {
  supplierKey: string;
  supplierProductId: string;
  refreshed: boolean;
  availabilityStatus: string;
  snapshotQuality: string;
  reevaluationReady: boolean;
  blockerReason?: string | null;
  refreshMode: string;
  exactMatchFound: boolean;
}) {
  const blockedReasons = normalizeBlockedReasons([
    input.blockerReason ?? null,
    !input.reevaluationReady ? input.availabilityStatus : null,
  ]);
  const confidence = inferConfidence({
    ok: input.refreshed && input.reevaluationReady,
    blockedReasons,
    explicit:
      input.snapshotQuality === "HIGH"
        ? 0.94
        : input.snapshotQuality === "MEDIUM"
          ? 0.72
          : input.snapshotQuality === "LOW"
            ? 0.48
            : 0.28,
  });

  await writeStageEvidence({
    evidenceType: "supplier_snapshot",
    entityType: "SUPPLIER_PRODUCT",
    entityId: `${canonicalSupplierKey(input.supplierKey)}:${input.supplierProductId}`,
    supplierKey: input.supplierKey,
    source: "refreshSingleSupplierProduct",
    confidence,
    blockedReasons,
    downstreamOutcome: input.reevaluationReady ? "READY_FOR_REEVALUATION" : "BLOCKED",
    diagnostics: {
      refreshed: input.refreshed,
      availabilityStatus: input.availabilityStatus,
      snapshotQuality: input.snapshotQuality,
      refreshMode: input.refreshMode,
      exactMatchFound: input.exactMatchFound,
    },
  });

  await writeStageEvidence({
    evidenceType: "stock_signal",
    entityType: "SUPPLIER_PRODUCT",
    entityId: `${canonicalSupplierKey(input.supplierKey)}:${input.supplierProductId}`,
    supplierKey: input.supplierKey,
    source: "refreshSingleSupplierProduct",
    confidence: input.availabilityStatus === "IN_STOCK" ? 0.9 : input.availabilityStatus === "LOW_STOCK" ? 0.55 : 0.25,
    blockedReasons,
    downstreamOutcome: input.availabilityStatus,
    diagnostics: {
      availabilityStatus: input.availabilityStatus,
      snapshotQuality: input.snapshotQuality,
      reevaluationReady: input.reevaluationReady,
    },
  });
}

export async function recordSupplierDiscoveryLearning(input: {
  processedCandidates: number;
  insertedCount: number;
  scannedProducts: number;
  scoredProducts: number;
  keywords: string[];
  sources: string[];
  sourcePlan: Array<{ source: string; searchLimit: number }>;
  sourceBreakdown: Array<{
    source: string;
    fetched_count: number;
    parsed_count: number;
    valid_count: number;
    eligible_count: number;
    inserted_new_count: number;
    rejected_quality_count: number;
    rejected_availability_count: number;
    rejected_unknown_reason_count: number;
    top_rejection_reasons: string[];
  }>;
}) {
  await writeStageEvidence({
    evidenceType: "supplier_snapshot",
    entityType: "PIPELINE_STAGE",
    entityId: "runSupplierDiscover",
    source: "runSupplierDiscover",
    confidence: inferConfidence({
      ratio: input.scannedProducts > 0 ? input.insertedCount / input.scannedProducts : 0,
      blockedReasons: input.insertedCount === 0 ? ["NO_DISCOVERABLE_SUPPLIER_ROWS"] : [],
    }),
    blockedReasons: input.insertedCount === 0 ? ["NO_DISCOVERABLE_SUPPLIER_ROWS"] : [],
    downstreamOutcome: input.insertedCount > 0 ? "SUPPLIER_ROWS_INSERTED" : "NO_SUPPLIER_ROWS_INSERTED",
    diagnostics: {
      processedCandidates: input.processedCandidates,
      insertedCount: input.insertedCount,
      scannedProducts: input.scannedProducts,
      scoredProducts: input.scoredProducts,
      keywords: input.keywords,
      sources: input.sources,
      sourcePlan: input.sourcePlan,
      sourceBreakdown: input.sourceBreakdown,
    },
  });

  for (const source of input.sourceBreakdown) {
    const passRate = source.fetched_count > 0 ? source.inserted_new_count / source.fetched_count : 0;
    await recordMetricSnapshot({
      metricKey: "supplier_discovery_yield",
      segmentKey: canonicalSupplierKey(source.source),
      metricValue: passRate,
      sampleSize: source.fetched_count,
      metadata: {
        parsed: source.parsed_count,
        valid: source.valid_count,
        eligible: source.eligible_count,
        rejectedQuality: source.rejected_quality_count,
        rejectedAvailability: source.rejected_availability_count,
        rejectedUnknown: source.rejected_unknown_reason_count,
      },
    });
  }
}

export async function recordShippingAutomationLearning(input: {
  scanned: number;
  persistedQuotes: number;
  recomputedCandidates: number;
  stillBlocked: number;
  exactRefreshAttempts: number;
  exactRefreshRecovered: number;
  alternateSupplierAttempts: number;
  alternateSupplierRecovered: number;
  bySupplier: Array<{ supplierKey: string; blocked: number; persistedQuotes: number }>;
  gapBreakdown: Array<{ rootCause: string; count: number }>;
}) {
  const successRatio = input.scanned > 0 ? input.persistedQuotes / input.scanned : 1;
  const blockedReasons = input.gapBreakdown
    .filter((row) => row.count > 0)
    .map((row) => `${row.rootCause}:${row.count}`);

  await writeStageEvidence({
    evidenceType: "shipping_quote",
    entityType: "PIPELINE_STAGE",
    entityId: "shippingAutomation",
    source: "automateShippingIntelligence",
    confidence: inferConfidence({ ratio: successRatio, blockedReasons }),
    blockedReasons,
    downstreamOutcome: input.stillBlocked > 0 ? "PARTIAL_RECOVERY" : "RECOVERED",
    diagnostics: {
      scanned: input.scanned,
      persistedQuotes: input.persistedQuotes,
      recomputedCandidates: input.recomputedCandidates,
      stillBlocked: input.stillBlocked,
      exactRefreshAttempts: input.exactRefreshAttempts,
      exactRefreshRecovered: input.exactRefreshRecovered,
      alternateSupplierAttempts: input.alternateSupplierAttempts,
      alternateSupplierRecovered: input.alternateSupplierRecovered,
      bySupplier: input.bySupplier,
    },
  });

  const shippingKnownRatio = input.scanned > 0 ? input.persistedQuotes / input.scanned : 1;
  await writeMetricWithDrift({
    metricKey: "shipping_known_ratio",
    metricValue: shippingKnownRatio,
    sampleSize: input.scanned,
    category: "shipping_ratio_regression",
    metadata: { stillBlocked: input.stillBlocked },
  });
}

export async function recordMarketplaceScanLearning(input: {
  platform: string;
  productRawId?: string;
  scanned?: number;
  upserted?: number;
  queryErrors?: number;
  acceptedCount?: number;
  rejectedLowScoreCount?: number;
}) {
  const scanned = toNumber(input.scanned);
  const upserted = toNumber(input.upserted);
  const queryErrors = toNumber(input.queryErrors);
  const confidence = inferConfidence({
    ratio: scanned > 0 ? upserted / scanned : queryErrors > 0 ? 0 : 1,
    blockedReasons: queryErrors > 0 ? [`QUERY_ERRORS:${queryErrors}`] : [],
  });

  await writeStageEvidence({
    evidenceType: "marketplace_snapshot",
    entityType: "PRODUCT_RAW",
    entityId: input.productRawId ?? `marketplace:${input.platform}:batch`,
    marketplaceKey: input.platform,
    source: "runTrendMarketplaceScanner",
    confidence,
    blockedReasons: queryErrors > 0 ? [`QUERY_ERRORS:${queryErrors}`] : [],
    downstreamOutcome: upserted > 0 ? "UPSERTED" : queryErrors > 0 ? "QUERY_ERROR" : "NO_ACCEPTED_MATCH",
    diagnostics: {
      scanned,
      upserted,
      queryErrors,
      acceptedCount: toNumber(input.acceptedCount),
      rejectedLowScoreCount: toNumber(input.rejectedLowScoreCount),
    },
  });
}

export async function recordMatchLearning(input: {
  scanned: number;
  inserted: number;
  updated: number;
  active: number;
  manualReview: number;
  rejected: number;
  skippedNoQualifiedCandidate: number;
}) {
  const scored = input.active + input.manualReview + input.rejected;
  await writeStageEvidence({
    evidenceType: "match",
    entityType: "PIPELINE_STAGE",
    entityId: "runEbayMatches",
    marketplaceKey: "ebay",
    source: "runEbayMatches",
    confidence: inferConfidence({ ratio: input.scanned > 0 ? scored / input.scanned : 1 }),
    blockedReasons: input.rejected > 0 ? [`REJECTED:${input.rejected}`] : [],
    downstreamOutcome: input.active > 0 ? "ACTIVE_MATCHES_CREATED" : "NO_ACTIVE_MATCHES",
    diagnostics: input,
  });

  await recordEvalLabel({
    labelType: "match_quality",
    entityType: "PIPELINE_STAGE",
    entityId: "runEbayMatches",
    predictedLabel: input.active > 0 ? "ACTIVE" : "WEAK",
    predictedConfidence: clamp01(scored > 0 ? input.active / scored : 0) ?? undefined,
    gradingNotes: `manual_review=${input.manualReview}; rejected=${input.rejected}`,
  });
}

export async function recordProfitLearning(input: {
  scanned: number;
  insertedOrUpdated: number;
  skipped: number;
  staleDeleted: number;
  minRoiPct: number;
  minMarginPct: number;
  minMatchConfidence: number;
}) {
  const successRatio = input.scanned > 0 ? input.insertedOrUpdated / input.scanned : 1;
  await writeStageEvidence({
    evidenceType: "candidate_decision",
    entityType: "PIPELINE_STAGE",
    entityId: "runProfitEngine",
    marketplaceKey: "ebay",
    source: "runProfitEngine",
    confidence: inferConfidence({ ratio: successRatio }),
    blockedReasons: input.skipped > 0 ? [`SKIPPED:${input.skipped}`] : [],
    downstreamOutcome: input.insertedOrUpdated > 0 ? "CANDIDATES_RECOMPUTED" : "NO_CANDIDATE_UPDATES",
    diagnostics: input,
  });
}

export async function recordListingPrepareLearning(input: {
  marketplace: string;
  scanned: number;
  created: number;
  updated: number;
  ready: number;
  reconciled: number;
  skipped: number;
  failed: number;
}) {
  await writeStageEvidence({
    evidenceType: "listing_decision",
    entityType: "PIPELINE_STAGE",
    entityId: "prepareListingPreviews",
    marketplaceKey: input.marketplace,
    source: "prepareListingPreviews",
    confidence: inferConfidence({
      ratio: input.scanned > 0 ? (input.created + input.updated + input.ready) / input.scanned : 1,
      blockedReasons: input.failed > 0 ? [`FAILED:${input.failed}`] : [],
    }),
    blockedReasons: input.failed > 0 ? [`FAILED:${input.failed}`] : [],
    downstreamOutcome: input.ready > 0 ? "PREVIEWS_READY" : "PREVIEWS_PREPARED",
    diagnostics: input,
  });
}

export async function recordPromotionLearning(input: {
  scanned: number;
  promoted: number;
  blocked: number;
  results: Array<{ listingId: string; candidateId: string; ok: boolean; reason: string | null }>;
}) {
  await writeStageEvidence({
    evidenceType: "listing_decision",
    entityType: "PIPELINE_STAGE",
    entityId: "promoteApprovedPreviewsToReady",
    marketplaceKey: "ebay",
    source: "promoteApprovedPreviewsToReady",
    confidence: inferConfidence({ ratio: input.scanned > 0 ? input.promoted / input.scanned : 1 }),
    blockedReasons: input.results.filter((row) => !row.ok).map((row) => row.reason),
    downstreamOutcome: input.promoted > 0 ? "READY_TO_PUBLISH_PROMOTED" : "PROMOTION_BLOCKED",
    diagnostics: input,
  });

  for (const result of input.results) {
    await writeStageEvidence({
      evidenceType: "listing_decision",
      entityType: "LISTING",
      entityId: result.listingId,
      marketplaceKey: "ebay",
      source: "promoteApprovedPreviewsToReady",
      confidence: result.ok ? 0.92 : 0.38,
      blockedReasons: result.ok ? [] : [result.reason],
      downstreamOutcome: result.ok ? "READY_TO_PUBLISH" : "BLOCKED",
      diagnostics: { candidateId: result.candidateId },
    });
  }
}

export async function recordPublishLearning(input: {
  executed: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  marketplaceKey: string;
}) {
  await writeStageEvidence({
    evidenceType: "publish_outcome",
    entityType: "PIPELINE_STAGE",
    entityId: "runListingExecution",
    marketplaceKey: input.marketplaceKey,
    source: "runListingExecution",
    confidence: inferConfidence({
      ratio: input.executed + input.failed > 0 ? input.executed / Math.max(1, input.executed + input.failed) : 1,
      blockedReasons: input.failed > 0 ? [`FAILED:${input.failed}`] : [],
    }),
    blockedReasons: input.failed > 0 ? [`FAILED:${input.failed}`] : [],
    downstreamOutcome: input.dryRun ? "DRY_RUN" : input.failed > 0 ? "PARTIAL_FAILURE" : "SUCCESS",
    diagnostics: input,
  });

  await recordEvalLabel({
    labelType: "publishability_quality",
    entityType: "PIPELINE_STAGE",
    entityId: "runListingExecution",
    predictedLabel: input.dryRun ? "DRY_RUN" : "LIVE_PUBLISH",
    predictedConfidence:
      input.dryRun ? 0.5 : (clamp01(input.executed / Math.max(1, input.executed + input.failed)) ?? undefined),
    observedLabel: input.dryRun ? "DRY_RUN" : input.failed > 0 ? "PARTIAL_FAILURE" : "SUCCESS",
    observedConfidence: input.dryRun ? 0.5 : input.failed > 0 ? 0.35 : 0.95,
    gradingNotes: `skipped=${input.skipped}`,
  });
}

export async function recordOrderSyncLearning(input: {
  fetched: number;
  normalized: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}) {
  await writeStageEvidence({
    evidenceType: "order_outcome",
    entityType: "PIPELINE_STAGE",
    entityId: "syncEbayOrders",
    marketplaceKey: "ebay",
    source: "syncEbayOrders",
    confidence: inferConfidence({
      ratio: input.normalized > 0 ? (input.created + input.updated + input.unchanged) / input.normalized : 1,
      blockedReasons: input.failed > 0 ? [`FAILED:${input.failed}`] : [],
    }),
    blockedReasons: input.failed > 0 ? [`FAILED:${input.failed}`] : [],
    downstreamOutcome: input.failed > 0 ? "PARTIAL_ORDER_SYNC" : "ORDER_SYNC_OK",
    diagnostics: input,
  });
}

export async function recordTrackingSyncLearning(input: {
  orderId: string;
  supplierOrderId: string | null;
  synced: boolean;
  attemptedLiveCall: boolean;
  reason: string | null;
}) {
  await writeStageEvidence({
    evidenceType: "order_outcome",
    entityType: "ORDER",
    entityId: input.orderId,
    marketplaceKey: "ebay",
    source: "syncTrackingToEbay",
    confidence: input.synced ? 0.94 : input.attemptedLiveCall ? 0.32 : 0.18,
    blockedReasons: input.reason ? [input.reason] : [],
    downstreamOutcome: input.synced ? "TRACKING_SYNCED" : "TRACKING_SYNC_BLOCKED",
    diagnostics: {
      supplierOrderId: input.supplierOrderId,
      attemptedLiveCall: input.attemptedLiveCall,
    },
  });
}

export async function refreshLearningOperationalFeedback() {
  const supplierRows = await db.execute<FeatureAggregate>(sql`
    WITH supplier_evidence AS (
      SELECT
        lower(coalesce(supplier_key, 'unknown')) AS supplier_key,
        count(*)::int AS sample_size,
        avg(CASE WHEN validation_status = 'PASS' THEN 1 ELSE 0 END)::float AS supplier_reliability,
        avg(CASE WHEN evidence_type = 'shipping_quote' AND validation_status = 'PASS' THEN 1 ELSE 0 END)::float AS shipping_reliability,
        avg(CASE WHEN evidence_type = 'stock_signal' AND validation_status = 'PASS' THEN 1 ELSE 0 END)::float AS stock_reliability,
        avg(CASE WHEN evidence_type = 'supplier_snapshot' AND validation_status <> 'FAIL' THEN 1 ELSE 0 END)::float AS parser_yield,
        avg(CASE WHEN downstream_outcome IN ('READY_TO_PUBLISH','SUCCESS','TRACKING_SYNCED','CANDIDATES_RECOMPUTED') THEN 1 ELSE 0 END)::float AS publishability,
        avg(CASE WHEN validation_status = 'FAIL' THEN 1 ELSE 0 END)::float AS failure_pressure
      FROM learning_evidence_events
      WHERE observed_at >= now() - interval '30 days'
        AND supplier_key IS NOT NULL
      GROUP BY 1
    )
    SELECT
      supplier_key AS "supplierKey",
      coalesce(supplier_reliability, 0)::float AS "supplierReliability",
      coalesce(shipping_reliability, 0)::float AS "shippingReliability",
      coalesce(stock_reliability, 0)::float AS "stockReliability",
      coalesce(parser_yield, 0)::float AS "parserYield",
      coalesce(publishability, 0)::float AS "publishability",
      coalesce(failure_pressure, 0)::float AS "failurePressure",
      sample_size AS "sampleSize"
    FROM supplier_evidence
  `);

  for (const row of supplierRows.rows ?? []) {
    const supplierKey = canonicalSupplierKey(row.supplierKey);
    await upsertLearningFeature({
      featureKey: "supplier_reliability_score",
      subjectType: "supplier",
      subjectKey: supplierKey,
      featureValue: toNumber(row.supplierReliability),
      confidence: 0.9,
      sampleSize: toNumber(row.sampleSize),
      metadata: { source: "refreshLearningOperationalFeedback" },
    });
    await upsertLearningFeature({
      featureKey: "shipping_reliability_score",
      subjectType: "supplier",
      subjectKey: supplierKey,
      featureValue: toNumber(row.shippingReliability),
      confidence: 0.84,
      sampleSize: toNumber(row.sampleSize),
      metadata: { source: "refreshLearningOperationalFeedback" },
    });
    await upsertLearningFeature({
      featureKey: "stock_reliability_score",
      subjectType: "supplier",
      subjectKey: supplierKey,
      featureValue: toNumber(row.stockReliability),
      confidence: 0.84,
      sampleSize: toNumber(row.sampleSize),
      metadata: { source: "refreshLearningOperationalFeedback" },
    });
    await upsertLearningFeature({
      featureKey: "parser_yield_score",
      subjectType: "supplier",
      subjectKey: supplierKey,
      featureValue: toNumber(row.parserYield),
      confidence: 0.82,
      sampleSize: toNumber(row.sampleSize),
      metadata: { source: "refreshLearningOperationalFeedback" },
    });
    await upsertLearningFeature({
      featureKey: "publishability_score",
      subjectType: "supplier",
      subjectKey: supplierKey,
      featureValue: toNumber(row.publishability),
      confidence: 0.8,
      sampleSize: toNumber(row.sampleSize),
      metadata: { source: "refreshLearningOperationalFeedback" },
    });
    await upsertLearningFeature({
      featureKey: "failure_pressure_score",
      subjectType: "supplier",
      subjectKey: supplierKey,
      featureValue: toNumber(row.failurePressure),
      confidence: 0.86,
      sampleSize: toNumber(row.sampleSize),
      metadata: { source: "refreshLearningOperationalFeedback" },
    });
  }

  const scoreRows = await db.execute<{
    metricKey: string;
    metricValue: number;
    sampleSize: number;
  }>(sql`
    WITH recent AS (
      SELECT *
      FROM learning_evidence_events
      WHERE observed_at >= now() - interval '14 days'
    )
    SELECT
      'evidence_pass_ratio'::text AS "metricKey",
      coalesce(avg(CASE WHEN validation_status = 'PASS' THEN 1 ELSE 0 END), 0)::float AS "metricValue",
      count(*)::int AS "sampleSize"
    FROM recent
    UNION ALL
    SELECT
      'shipping_quality_ratio'::text,
      coalesce(avg(CASE WHEN evidence_type = 'shipping_quote' AND validation_status = 'PASS' THEN 1 ELSE 0 END), 0)::float,
      count(*) FILTER (WHERE evidence_type = 'shipping_quote')::int
    FROM recent
    UNION ALL
    SELECT
      'stock_quality_ratio'::text,
      coalesce(avg(CASE WHEN evidence_type = 'stock_signal' AND validation_status = 'PASS' THEN 1 ELSE 0 END), 0)::float,
      count(*) FILTER (WHERE evidence_type = 'stock_signal')::int
    FROM recent
    UNION ALL
    SELECT
      'publish_success_ratio'::text,
      coalesce(avg(CASE WHEN evidence_type = 'publish_outcome' AND downstream_outcome = 'SUCCESS' THEN 1 ELSE 0 END), 0)::float,
      count(*) FILTER (WHERE evidence_type = 'publish_outcome')::int
    FROM recent
  `);

  for (const row of scoreRows.rows ?? []) {
    if (!row.metricKey) continue;
    const category =
      row.metricKey === "shipping_quality_ratio"
        ? "shipping_ratio_regression"
        : row.metricKey === "stock_quality_ratio"
          ? "stock_ratio_regression"
          : row.metricKey === "publish_success_ratio"
            ? "candidate_pool_degradation"
            : "evidence_quality_degradation";
    await writeMetricWithDrift({
      metricKey: row.metricKey,
      metricValue: toNumber(row.metricValue),
      sampleSize: toNumber(row.sampleSize),
      category,
    });
  }

  return {
    ok: true,
    supplierFeaturesUpdated: supplierRows.rows?.length ?? 0,
    scoreMetricsUpdated: scoreRows.rows?.length ?? 0,
  };
}

export async function recordOperationalSummaryLearning(input: {
  shippingBlocks: number;
  manualPurchaseQueueCount: number;
  publishableRatio: number;
  manualReviewRatio: number;
  blockedByShippingRatio: number;
  blockedByProfitRatio: number;
  blockedByLinkageRatio: number;
  supplierMix: Array<{ supplierKey: string; shareOfPool: number; publishable: number; manualReview: number }>;
}) {
  await writeMetricWithDrift({
    metricKey: "manual_purchase_queue_count",
    metricValue: input.manualPurchaseQueueCount,
    sampleSize: 1,
    category: "candidate_pool_degradation",
  });
  await writeMetricWithDrift({
    metricKey: "publishable_ratio",
    metricValue: input.publishableRatio,
    sampleSize: 1,
    category: "candidate_pool_degradation",
  });
  await writeMetricWithDrift({
    metricKey: "manual_review_ratio",
    metricValue: input.manualReviewRatio,
    sampleSize: 1,
    category: "candidate_pool_degradation",
  });
  await writeMetricWithDrift({
    metricKey: "blocked_by_shipping_ratio",
    metricValue: input.blockedByShippingRatio,
    sampleSize: 1,
    category: "shipping_ratio_regression",
  });
  await writeMetricWithDrift({
    metricKey: "blocked_by_profit_ratio",
    metricValue: input.blockedByProfitRatio,
    sampleSize: 1,
    category: "candidate_pool_degradation",
  });
  await writeMetricWithDrift({
    metricKey: "blocked_by_linkage_ratio",
    metricValue: input.blockedByLinkageRatio,
    sampleSize: 1,
    category: "candidate_pool_degradation",
  });

  for (const supplier of input.supplierMix) {
    await recordMetricSnapshot({
      metricKey: "supplier_mix_share",
      segmentKey: canonicalSupplierKey(supplier.supplierKey),
      metricValue: supplier.shareOfPool,
      sampleSize: supplier.publishable + supplier.manualReview,
      metadata: {
        publishable: supplier.publishable,
        manualReview: supplier.manualReview,
      },
    });
  }
}

export async function getSupplierLearningAdjustments() {
  const result = await db.execute<{
    subjectKey: string;
    supplierReliability: number | null;
    shippingReliability: number | null;
    stockReliability: number | null;
    parserYield: number | null;
    publishability: number | null;
    failurePressure: number | null;
  }>(sql`
    SELECT
      subject_key AS "subjectKey",
      max(CASE WHEN feature_key = 'supplier_reliability_score' THEN feature_value END)::float AS "supplierReliability",
      max(CASE WHEN feature_key = 'shipping_reliability_score' THEN feature_value END)::float AS "shippingReliability",
      max(CASE WHEN feature_key = 'stock_reliability_score' THEN feature_value END)::float AS "stockReliability",
      max(CASE WHEN feature_key = 'parser_yield_score' THEN feature_value END)::float AS "parserYield",
      max(CASE WHEN feature_key = 'publishability_score' THEN feature_value END)::float AS "publishability",
      max(CASE WHEN feature_key = 'failure_pressure_score' THEN feature_value END)::float AS "failurePressure"
    FROM learning_features
    WHERE subject_type = 'supplier'
      AND feature_key IN (
        'supplier_reliability_score',
        'shipping_reliability_score',
        'stock_reliability_score',
        'parser_yield_score',
        'publishability_score',
        'failure_pressure_score'
      )
    GROUP BY subject_key
  `);

  return new Map(
    (result.rows ?? []).map((row) => [
      canonicalSupplierKey(row.subjectKey),
      {
        supplierReliability: clamp01(row.supplierReliability) ?? 0,
        shippingReliability: clamp01(row.shippingReliability) ?? 0,
        stockReliability: clamp01(row.stockReliability) ?? 0,
        parserYield: clamp01(row.parserYield) ?? 0,
        publishability: clamp01(row.publishability) ?? 0,
        failurePressure: clamp01(row.failurePressure) ?? 0,
      },
    ])
  );
}
