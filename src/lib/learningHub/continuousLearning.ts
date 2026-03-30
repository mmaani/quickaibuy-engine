import { recordMetricSnapshot } from "@/lib/learningHub/drift";
import { getLearningFreshnessOverview, type LearningFreshnessOverview } from "@/lib/learningHub/freshness";
import { getProductMarketIntelligenceOverview } from "@/lib/learningHub/productMarketIntelligence";
import { refreshLearningOperationalFeedback } from "@/lib/learningHub/pipelineWriters";
import { getLearningHubScorecard } from "@/lib/learningHub/scorecard";
import { upsertLearningFeature } from "@/lib/learningHub/featureStore";

export type ContinuousLearningStageKey =
  | "supplier_score_recompute"
  | "shipping_quality_recompute"
  | "category_intelligence_recompute"
  | "product_profile_intelligence_recompute"
  | "marketplace_fit_recompute"
  | "attribute_intelligence_recompute"
  | "opportunity_score_recompute"
  | "drift_anomaly_recompute"
  | "scorecard_refresh";

export type ContinuousLearningStageResult = {
  key: ContinuousLearningStageKey;
  status: "completed" | "failed";
  details?: Record<string, unknown>;
  error?: string;
};

export type ContinuousLearningRunResult = {
  ok: boolean;
  generatedAt: string;
  trigger: string;
  stages: ContinuousLearningStageResult[];
  freshness: LearningFreshnessOverview;
};

async function persistProductMarketIntelligence() {
  const overview = await getProductMarketIntelligenceOverview({ windowDays: 90, includeNodes: 20 });

  for (const row of overview.categoryIntelligence.strongest.concat(overview.categoryIntelligence.weakest)) {
    await upsertLearningFeature({
      featureKey: "category_opportunity_score",
      subjectType: "category",
      subjectKey: row.key,
      featureValue: row.opportunityScore,
      confidence: 0.8,
      sampleSize: row.productCount,
      metadata: {
        label: row.label,
        recommendation: row.recommendation,
        source: "runContinuousLearningRefresh",
      },
    });
  }

  for (const row of overview.productProfileIntelligence.strongest.concat(overview.productProfileIntelligence.weakest)) {
    await upsertLearningFeature({
      featureKey: "product_profile_opportunity_score",
      subjectType: "product_profile",
      subjectKey: row.key,
      featureValue: row.opportunityScore,
      confidence: 0.8,
      sampleSize: row.productCount,
      metadata: {
        label: row.label,
        categoryKey: row.categoryKey,
        recommendation: row.recommendation,
        source: "runContinuousLearningRefresh",
      },
    });
  }

  for (const row of overview.marketplaceFitIntelligence) {
    await upsertLearningFeature({
      featureKey: "marketplace_fit_score",
      subjectType: "marketplace_fit",
      subjectKey: `${row.marketplaceKey}:${row.categoryKey}`,
      featureValue: row.fitScore,
      confidence: 0.78,
      sampleSize: row.productCount,
      metadata: {
        categoryLabel: row.categoryLabel,
        marketplaceKey: row.marketplaceKey,
        source: "runContinuousLearningRefresh",
      },
    });
  }

  for (const row of overview.attributeIntelligence.slice(0, 40)) {
    await upsertLearningFeature({
      featureKey: "attribute_intelligence_priority",
      subjectType: "attribute_intelligence",
      subjectKey: `${row.categoryKey}:${row.profileKey}:${row.attributeKey}`,
      featureValue: row.coverageRatio,
      confidence: 0.75,
      sampleSize: Math.max(1, Math.round((row.publishSuccessWhenPresent + row.publishSuccessWhenMissing) * 100)),
      metadata: {
        categoryLabel: row.categoryLabel,
        profileLabel: row.profileLabel,
        priority: row.priority,
        source: "runContinuousLearningRefresh",
      },
    });
  }

  for (const row of overview.supplierMarketplaceIntelligence) {
    await upsertLearningFeature({
      featureKey: "supplier_marketplace_opportunity_score",
      subjectType: "supplier_marketplace",
      subjectKey: `${row.supplierKey}:${row.marketplaceKey}`,
      featureValue: row.opportunityScore,
      confidence: 0.8,
      sampleSize: row.productCount,
      metadata: {
        categoryCount: row.categoryCount,
        publishableRatio: row.publishableRatio,
        publishSuccessRatio: row.publishSuccessRatio,
        source: "runContinuousLearningRefresh",
      },
    });
  }

  for (const row of overview.opportunities) {
    await upsertLearningFeature({
      featureKey: "opportunity_score",
      subjectType: "opportunity_candidate",
      subjectKey: row.candidateId,
      featureValue: row.opportunity.score,
      confidence: 0.82,
      sampleSize: 1,
      metadata: {
        supplierKey: row.supplierKey,
        marketplaceKey: row.marketplaceKey,
        categoryKey: row.taxonomy.categoryKey,
        profileKey: row.taxonomy.profileKey,
        source: "runContinuousLearningRefresh",
      },
    });
  }

  return overview;
}

async function persistScorecardFeatures() {
  const scorecard = await getLearningHubScorecard();
  if (!scorecard) return null;

  const evidencePassRatio =
    scorecard.evidence.total > 0 ? scorecard.evidence.pass / Math.max(1, scorecard.evidence.total) : 0;
  const driftPressure =
    scorecard.openDrift.total > 0 ? scorecard.openDrift.critical / Math.max(1, scorecard.openDrift.total) : 0;

  await upsertLearningFeature({
    featureKey: "scorecard_freshness_health",
    subjectType: "control_plane",
    subjectKey: "learning_hub",
    featureValue: Math.max(0, Math.min(1, evidencePassRatio - driftPressure)),
    confidence: 0.85,
    sampleSize: scorecard.evidence.total,
    metadata: {
      evidencePassRatio,
      driftPressure,
      source: "runContinuousLearningRefresh",
    },
  });

  await recordMetricSnapshot({
    metricKey: "learning_scorecard_evidence_pass_ratio",
    metricValue: evidencePassRatio,
    sampleSize: scorecard.evidence.total,
    metadata: { source: "runContinuousLearningRefresh" },
  });

  return scorecard;
}

async function persistFreshnessMetrics(freshness: LearningFreshnessOverview) {
  for (const domain of freshness.domains) {
    await recordMetricSnapshot({
      metricKey: `freshness_${domain.key}`,
      metricValue: domain.state === "fresh" ? 1 : domain.state === "warn" ? 0.5 : 0,
      sampleSize: 1,
      metadata: {
        label: domain.label,
        ageHours: domain.ageHours,
        warnAfterHours: domain.warnAfterHours,
        errorAfterHours: domain.errorAfterHours,
        state: domain.state,
        source: "runContinuousLearningRefresh",
      },
    });
  }
}

export async function runContinuousLearningRefresh(input?: {
  trigger?: string;
  forceFull?: boolean;
}): Promise<ContinuousLearningRunResult> {
  const generatedAt = new Date().toISOString();
  const trigger = String(input?.trigger ?? "manual").trim() || "manual";
  const stages: ContinuousLearningStageResult[] = [];

  try {
    const operational = await refreshLearningOperationalFeedback();
    stages.push({
      key: "supplier_score_recompute",
      status: "completed",
      details: operational,
    });
    stages.push({
      key: "shipping_quality_recompute",
      status: "completed",
      details: operational,
    });
    stages.push({
      key: "drift_anomaly_recompute",
      status: "completed",
      details: { scoreMetricsUpdated: operational.scoreMetricsUpdated },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stages.push({ key: "supplier_score_recompute", status: "failed", error: message });
    stages.push({ key: "shipping_quality_recompute", status: "failed", error: message });
    stages.push({ key: "drift_anomaly_recompute", status: "failed", error: message });
  }

  try {
    const overview = await persistProductMarketIntelligence();
    stages.push({
      key: "category_intelligence_recompute",
      status: "completed",
      details: { strongest: overview.categoryIntelligence.strongest.length, weakest: overview.categoryIntelligence.weakest.length },
    });
    stages.push({
      key: "product_profile_intelligence_recompute",
      status: "completed",
      details: { strongest: overview.productProfileIntelligence.strongest.length, weakest: overview.productProfileIntelligence.weakest.length },
    });
    stages.push({
      key: "marketplace_fit_recompute",
      status: "completed",
      details: { rows: overview.marketplaceFitIntelligence.length },
    });
    stages.push({
      key: "attribute_intelligence_recompute",
      status: "completed",
      details: { rows: overview.attributeIntelligence.length },
    });
    stages.push({
      key: "opportunity_score_recompute",
      status: "completed",
      details: { rows: overview.opportunities.length },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stages.push({ key: "category_intelligence_recompute", status: "failed", error: message });
    stages.push({ key: "product_profile_intelligence_recompute", status: "failed", error: message });
    stages.push({ key: "marketplace_fit_recompute", status: "failed", error: message });
    stages.push({ key: "attribute_intelligence_recompute", status: "failed", error: message });
    stages.push({ key: "opportunity_score_recompute", status: "failed", error: message });
  }

  try {
    const scorecard = await persistScorecardFeatures();
    stages.push({
      key: "scorecard_refresh",
      status: "completed",
      details: {
        available: Boolean(scorecard),
        evidenceTotal: scorecard?.evidence.total ?? 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stages.push({ key: "scorecard_refresh", status: "failed", error: message });
  }

  const freshness = await getLearningFreshnessOverview();
  await persistFreshnessMetrics(freshness);

  return {
    ok: !stages.some((stage) => stage.status === "failed"),
    generatedAt,
    trigger,
    stages,
    freshness,
  };
}
