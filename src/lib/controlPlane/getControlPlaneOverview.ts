import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getLearningHubScorecard, type LearningHubScorecard } from "@/lib/learningHub/scorecard";
import {
  getProductMarketIntelligenceOverview,
  type ProductMarketIntelligenceOverview,
} from "@/lib/learningHub/productMarketIntelligence";
import {
  buildOperationalSummary,
  computePauseMap,
  getRuntimeDiagnostics,
  type AutonomousOpsRunResult,
  type AutonomousOpsSummary,
  type StageKey,
} from "@/lib/autonomousOps/backbone";
import type { FullCycleRunResult } from "@/lib/autonomousOps/fullCycle";
import { getContinuousLearningScheduleSnapshot } from "@/lib/jobs/enqueueContinuousLearningSchedules";

type LatestRunSnapshot = {
  generatedAt: string | null;
  phase: string | null;
  ok: boolean | null;
  stages: Array<{ key: string; status: string; reasonCode: string | null }>;
  failedStages: Array<{ key: string; reasonCode: string | null }>;
  pausedStages: Array<{ key: string; reason: string }>;
  completedStages: string[];
};

type PauseSource = "runtime" | "latest_run";

type IntegrityHealSnapshot = {
  generatedAt: string | null;
  orphanReadyToPublishClosed: number;
  detachedPreviewsArchived: number;
  orphanActivePaused: number;
  stalePublishInProgressFailed: number;
  brokenLineageContained: number;
};

type AssistantRecommendation = {
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
};

export type ControlPlaneOverview = {
  generatedAt: string;
  runtime: {
    dotenvPath: string | null;
    envSource: string | null;
    dbTargetClassification: string | null;
    hasEbayClientId: boolean;
    hasEbayClientSecret: boolean;
    sensitiveFilesPresent: string[];
    sensitiveFilePolicy: {
      canonical: Array<{ file: string; present: boolean }>;
      compatibility: Array<{ file: string; present: boolean }>;
      compatibilitySensitive: Array<{ file: string; present: boolean }>;
      operatingBranch: "main";
      canonicalFullCycleCommand: "pnpm ops:full-cycle";
    } | null;
  };
  summary: AutonomousOpsSummary;
  pauses: Array<{ stage: StageKey; reason: string }>;
  pauseSource: PauseSource;
  latestRun: LatestRunSnapshot | null;
  latestFullCycleRun: LatestRunSnapshot | null;
  latestIntegrityHeal: IntegrityHealSnapshot | null;
  health: {
    pipelineState: "healthy" | "watch" | "paused";
    humanActionRequired: boolean;
    manualWorkLabel: string;
    safeToRunFullCycleNow: boolean;
  };
  anomalyGroups: Array<{
    key: string;
    label: string;
    count: number;
    detail: string;
  }>;
  recommendations: AssistantRecommendation[];
  learningHub: LearningHubScorecard | null;
  productMarketIntelligence: ProductMarketIntelligenceOverview | null;
  continuousLearning: {
    schedule: Awaited<ReturnType<typeof getContinuousLearningScheduleSnapshot>> | null;
    staleWarnings: Array<{ key: string; label: string; state: "fresh" | "warn" | "error"; warning: string }>;
  };
  routeMap: Array<{
    route: string;
    loader: string;
    primaryFocus: string;
  }>;
};

const STAGE_KEYS: StageKey[] = [
  "runtime_diagnostics",
  "integrity_scan",
  "integrity_heal",
  "supplier_refresh",
  "marketplace_refresh",
  "shipping_refresh",
  "match_recompute",
  "profit_recompute",
  "listing_prepare",
  "publish_ready_promotion",
  "guarded_publish_execution",
  "health_summary",
];

function asStageKey(value: string): StageKey | null {
  return STAGE_KEYS.find((stage) => stage === value) ?? null;
}

function deriveRunWindowPauses(latestRun: LatestRunSnapshot | null): Array<{ stage: StageKey; reason: string }> {
  if (!latestRun) return [];

  const pausedStages = latestRun.pausedStages
    .map((pause) => {
      const stage = asStageKey(pause.key);
      if (!stage) return null;
      return {
        stage,
        reason: pause.reason,
      };
    })
    .filter((row): row is { stage: StageKey; reason: string } => Boolean(row));

  if (pausedStages.length) return pausedStages;

  return latestRun.stages
    .filter((stage) => stage.status === "paused")
    .map((stage) => {
      const stageKey = asStageKey(stage.key);
      if (!stageKey) return null;
      return {
        stage: stageKey,
        reason: stage.reasonCode ?? "PAUSED",
      };
    })
    .filter((row): row is { stage: StageKey; reason: string } => Boolean(row));
}

function parseLatestRun(details: unknown): LatestRunSnapshot | null {
  if (!details || typeof details !== "object") return null;
  const run = details as Partial<AutonomousOpsRunResult & FullCycleRunResult>;
  const stages = Array.isArray(run.stages) ? run.stages : [];
  const pauses = Array.isArray(run.pauses) ? run.pauses : [];
  return {
    generatedAt: typeof run.generatedAt === "string" ? run.generatedAt : null,
    phase: typeof run.phase === "string" ? run.phase : null,
    ok: typeof run.ok === "boolean" ? run.ok : null,
    stages: stages.map((stage) => ({
      key: String(stage.key ?? "unknown"),
      status: String(stage.status ?? "unknown"),
      reasonCode: stage.reasonCode ? String(stage.reasonCode) : null,
    })),
    failedStages: stages
      .filter((stage) => stage && stage.status === "failed")
      .map((stage) => ({
        key: String(stage.key ?? "unknown"),
        reasonCode: stage.reasonCode ? String(stage.reasonCode) : null,
      })),
    pausedStages: pauses.map((pause) => ({
      key: String(pause.stage ?? "unknown"),
      reason: String(pause.reason ?? "PAUSED"),
    })),
    completedStages: stages
      .filter((stage) => stage && stage.status === "completed")
      .map((stage) => String(stage.key ?? "unknown")),
  };
}

function extractLatestIntegrityHeal(details: unknown): IntegrityHealSnapshot | null {
  if (!details || typeof details !== "object") return null;
  const run = details as Partial<AutonomousOpsRunResult>;
  const stages = Array.isArray(run.stages) ? run.stages : [];
  const integrityHeal = stages.find((stage) => stage?.key === "integrity_heal");
  const payload =
    integrityHeal && integrityHeal.details && typeof integrityHeal.details === "object"
      ? (integrityHeal.details as Record<string, unknown>)
      : null;
  if (!payload) return null;

  const toCount = (key: string) =>
    Array.isArray(payload[key]) ? payload[key].length : Number(payload[key] ?? 0) || 0;

  return {
    generatedAt: typeof run.generatedAt === "string" ? run.generatedAt : null,
    orphanReadyToPublishClosed: toCount("orphanReadyToPublishClosed"),
    detachedPreviewsArchived: toCount("detachedPreviewsArchived"),
    orphanActivePaused: toCount("orphanActivePaused"),
    stalePublishInProgressFailed: toCount("stalePublishInProgressFailed"),
    brokenLineageContained: toCount("brokenLineageContained"),
  };
}

async function getLatestAutonomousRunDetails(): Promise<unknown | null> {
  const result = await db.execute<{ details: unknown }>(sql`
    SELECT details
    FROM audit_log
    WHERE event_type = 'AUTONOMOUS_OPS_BACKBONE_COMPLETED'
    ORDER BY event_ts DESC
    LIMIT 1
  `);
  return result.rows?.[0]?.details ?? null;
}

async function getLatestFullCycleRunDetails(): Promise<unknown | null> {
  const result = await db.execute<{ details: unknown }>(sql`
    SELECT details
    FROM audit_log
    WHERE event_type = 'FULL_CYCLE_RUN_COMPLETED'
    ORDER BY event_ts DESC
    LIMIT 1
  `);
  return result.rows?.[0]?.details ?? null;
}

function buildAnomalyGroups(
  summary: AutonomousOpsSummary,
  pauses: Array<{ stage: StageKey; reason: string }>,
  latestRun: LatestRunSnapshot | null,
  learningHub: LearningHubScorecard | null
) {
  const groups = [
    {
      key: "shipping-blocks",
      label: "Shipping Unknown",
      count: Number(summary.shippingBlocks ?? 0),
      detail: `${summary.shippingBlocks} candidates remain blocked by missing deterministic shipping intelligence.`,
    },
    {
      key: "stale-marketplace",
      label: "Marketplace Staleness",
      count: Number(summary.marketplaceReliability.staleMarketplaceCandidates ?? 0),
      detail: `${summary.marketplaceReliability.staleMarketplaceCandidates} candidates are blocked by stale marketplace data.`,
    },
    {
      key: "integrity",
      label: "Integrity Drift",
      count:
        Number(summary.integrity.orphanReadyToPublishCount ?? 0) +
        Number(summary.integrity.detachedPreviewCount ?? 0) +
        Number(summary.integrity.orphanActiveCount ?? 0) +
        Number(summary.integrity.brokenLineageCount ?? 0),
      detail: "Orphan, detached, or broken-lineage listings still exist in the live state.",
    },
    {
      key: "paused-stages",
      label: "Paused Autonomous Stages",
      count: pauses.length,
      detail:
        pauses.length > 0
          ? pauses.map((pause) => `${pause.stage}: ${pause.reason}`).join("; ")
          : "No current autonomous pause reasons.",
    },
    {
      key: "failed-stages",
      label: "Latest Run Failures",
      count: latestRun?.failedStages.length ?? 0,
      detail:
        latestRun?.failedStages.length
          ? latestRun.failedStages.map((stage) => `${stage.key}: ${stage.reasonCode ?? "FAILED"}`).join("; ")
          : "Latest autonomous run did not report any failed stages.",
    },
    {
      key: "learning-staleness",
      label: "Stale Learning Domains",
      count: learningHub?.freshness.staleDomainCount ?? 0,
      detail:
        learningHub?.freshness.domains
          .filter((domain) => domain.state === "error")
          .map((domain) => `${domain.label}: ${domain.visibleWarning}`)
          .join("; ") ?? "No stale learning domains.",
    },
  ];

  return groups.filter((group) => group.count > 0);
}

function buildRecommendations(
  summary: AutonomousOpsSummary,
  pauses: Array<{ stage: StageKey; reason: string }>,
  latestRun: LatestRunSnapshot | null,
  learningHub: LearningHubScorecard | null
): AssistantRecommendation[] {
  const recommendations: AssistantRecommendation[] = [];

  if (summary.shippingBlocks > 0) {
    recommendations.push({
      title: "Keep publish paused on shipping truth",
      detail:
        "Shipping remains fail-closed. Prioritize deterministic supplier shipping evidence or stronger suppliers before trying to increase publish throughput.",
      severity: "critical",
    });
  }

  if (summary.integrity.detachedPreviewCount > 0 || summary.integrity.orphanActiveCount > 0) {
    recommendations.push({
      title: "Integrity healing should run before prepare/publish",
      detail:
        "Detached previews or orphan listings are still present. Let the backbone heal them before any downstream listing progression.",
      severity: "warning",
    });
  }

  if (summary.marketplaceReliability.staleMarketplaceCandidates > 0) {
    recommendations.push({
      title: "Refresh stale marketplace rows before review",
      detail:
        "Candidates blocked by marketplace snapshot age should be refreshed and recomputed before operator review consumes them.",
      severity: "warning",
    });
  }

  const dominantSupplier = [...summary.candidateUniverse.supplierMix]
    .sort((left, right) => right.totalCandidates - left.totalCandidates)[0];
  if (
    dominantSupplier &&
    dominantSupplier.supplierKey === "aliexpress" &&
    dominantSupplier.shareOfPool >= 0.45
  ) {
    recommendations.push({
      title: "Reset the next candidate wave toward stronger suppliers",
      detail: `AliExpress still represents ${Math.round(dominantSupplier.shareOfPool * 100)}% of the current candidate pool. Prefer CJ and Temu in the next discovery wave to reduce weak-evidence manual-review churn.`,
      severity: "warning",
    });
  }

  const weakestSupplier = [...summary.supplierReliability]
    .filter((row) => row.candidates > 0)
    .sort((left, right) => {
      const leftScore = (left.refreshSuccessRate ?? 0) - left.shippingBlocked / Math.max(left.candidates, 1);
      const rightScore = (right.refreshSuccessRate ?? 0) - right.shippingBlocked / Math.max(right.candidates, 1);
      return leftScore - rightScore;
    })[0];
  if (
    weakestSupplier &&
    weakestSupplier.supplierKey === "aliexpress" &&
    (
      weakestSupplier.shippingBlocked > 0 ||
      weakestSupplier.rateLimitEvents > 0 ||
      weakestSupplier.exactMatchMisses > 0 ||
      (weakestSupplier.refreshSuccessRate ?? 1) < 0.95
    )
  ) {
    recommendations.push({
      title: "Keep AliExpress contained behind stronger suppliers",
      detail: `AliExpress remains a low-priority supplier path: refresh success ${(weakestSupplier.refreshSuccessRate ?? 0) * 100}% with ${weakestSupplier.shippingBlocked}/${weakestSupplier.candidates} candidates shipping-blocked and ${weakestSupplier.rateLimitEvents + weakestSupplier.exactMatchMisses} reliability pressure events.`,
      severity: "warning",
    });
  }

  if ((latestRun?.failedStages.length ?? 0) > 0) {
    recommendations.push({
      title: "Investigate latest autonomous stage failures",
      detail:
        latestRun?.failedStages.map((stage) => `${stage.key} (${stage.reasonCode ?? "FAILED"})`).join(", ") ??
        "The latest autonomous run reported failures.",
      severity: "warning",
    });
  }

  const staleWarnings = learningHub?.freshness.domains.filter((domain) => domain.state !== "fresh") ?? [];
  if (staleWarnings.length > 0) {
    recommendations.push({
      title: "Visible learning staleness is active",
      detail: staleWarnings.map((domain) => `${domain.label}: ${domain.state}`).join(", "),
      severity: staleWarnings.some((domain) => domain.state === "error") ? "critical" : "warning",
    });
  }

  if (summary.manualPurchaseQueueCount > 0) {
    recommendations.push({
      title: "Human work is ready in purchase review",
      detail: `${summary.manualPurchaseQueueCount} orders are waiting for human supplier purchase/payment handling.`,
      severity: "info",
    });
  } else {
    recommendations.push({
      title: "No purchase-review work is waiting",
      detail: "The remaining operator work is limited to exceptional investigations rather than routine purchase review.",
      severity: "info",
    });
  }

  if (pauses.length === 0 && summary.shippingBlocks === 0) {
    recommendations.push({
      title: "Autonomous flow is clear to continue",
      detail: "No current pause reasons are active. Routine refresh, prepare, and guarded publish stages can continue automatically.",
      severity: "info",
    });
  }

  return recommendations.slice(0, 5);
}

export async function getControlPlaneOverview(): Promise<ControlPlaneOverview> {
  const runtime = await getRuntimeDiagnostics();
  const summary = await buildOperationalSummary(runtime);
  const [learningHub, productMarketIntelligence, continuousLearningSchedule] = await Promise.all([
    getLearningHubScorecard(),
    getProductMarketIntelligenceOverview({ windowDays: 90, includeNodes: 12 }).catch(() => null),
    getContinuousLearningScheduleSnapshot().catch(() => null),
  ]);
  const pauseMap = await computePauseMap(runtime, summary, learningHub);
  const latestRunDetails = await getLatestAutonomousRunDetails();
  const latestRun = parseLatestRun(latestRunDetails);
  const latestFullCycleRunDetails = await getLatestFullCycleRunDetails();
  const latestFullCycleRun = parseLatestRun(latestFullCycleRunDetails);
  const latestIntegrityHeal = extractLatestIntegrityHeal(latestRunDetails);
  const runtimePauses = Array.from(pauseMap.entries()).map(([stage, reason]) => ({ stage, reason }));
  const runWindowPauses = deriveRunWindowPauses(latestRun);
  const hasOpenCriticalDrift = Number(learningHub?.openDrift.critical ?? 0) > 0;
  const reconciledRunWindowPauses = runWindowPauses.filter(
    (pause) => pause.reason !== "LEARNING_HUB_CRITICAL_DRIFT" || hasOpenCriticalDrift
  );
  const pauses = reconciledRunWindowPauses.length ? reconciledRunWindowPauses : runtimePauses;
  const pauseSource: PauseSource = reconciledRunWindowPauses.length ? "latest_run" : "runtime";
  const anomalyGroups = buildAnomalyGroups(summary, pauses, latestRun, learningHub);
  const recommendations = buildRecommendations(summary, pauses, latestRun, learningHub);
  const safeToRunFullCycleNow =
    runtime.hasEbayClientId &&
    runtime.hasEbayClientSecret &&
    pauses.length === 0 &&
    summary.integrity.orphanReadyToPublishCount === 0 &&
    summary.integrity.detachedPreviewCount === 0 &&
    summary.integrity.orphanActiveCount === 0 &&
    summary.integrity.brokenLineageCount === 0;

  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      ...runtime,
      sensitiveFilesPresent: runtime.sensitiveFilesPresent ?? [],
      sensitiveFilePolicy: runtime.sensitiveFilePolicy ?? null,
    },
    summary,
    pauses,
    pauseSource,
    latestRun,
    latestFullCycleRun,
    latestIntegrityHeal,
    health: {
      pipelineState: pauses.length > 0 ? "paused" : anomalyGroups.length > 0 ? "watch" : "healthy",
      humanActionRequired: summary.manualPurchaseQueueCount > 0,
      safeToRunFullCycleNow,
      manualWorkLabel:
        summary.manualPurchaseQueueCount > 0
          ? `${summary.manualPurchaseQueueCount} orders need supplier purchase/payment`
          : "Supplier purchase/payment only when orders reach purchase review",
    },
    anomalyGroups,
    recommendations,
    learningHub,
    productMarketIntelligence,
    continuousLearning: {
      schedule: continuousLearningSchedule,
      staleWarnings:
        learningHub?.freshness.domains
          .filter((domain) => domain.state !== "fresh")
          .map((domain) => ({
            key: domain.key,
            label: domain.label,
            state: domain.state,
            warning: domain.visibleWarning,
          })) ?? [],
    },
    routeMap: [
      {
        route: "/dashboard",
        loader: "@/lib/dashboard/getDashboardData + @/lib/controlPlane/getControlPlaneOverview",
        primaryFocus: "Operational truth, freshness, and autonomous stage health",
      },
      {
        route: "/admin/control",
        loader: "@/lib/control/getControlPanelData + @/lib/controlPlane/getControlPlaneOverview",
        primaryFocus: "Control actions, reliability, self-pausing, and recovery state",
      },
      {
        route: "/admin/review",
        loader: "@/lib/review/console + @/lib/controlPlane/getControlPlaneOverview",
        primaryFocus: "Candidate exceptions and approval blockers",
      },
      {
        route: "/admin/listings",
        loader: "@/lib/listings/getApprovedListingsQueueData + @/lib/controlPlane/getControlPlaneOverview",
        primaryFocus: "Preview, ready, recovery, and listing-state integrity",
      },
      {
        route: "/admin/orders",
        loader: "@/lib/orders + @/lib/controlPlane/getControlPlaneOverview",
        primaryFocus: "Purchase review, tracking sync, and remaining human work",
      },
    ],
  };
}
