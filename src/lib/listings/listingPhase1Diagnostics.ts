import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { optimizeListingTitle } from "@/lib/listings/optimizeListingTitle";

export type KillDecision = "KEEP" | "MANUAL_REVIEW" | "EVOLVE_FIRST" | "AUTO_KILL";

export type ListingKillEvaluation = {
  kill_score: number;
  kill_decision: KillDecision;
  kill_reason_codes: string[];
  kill_evaluated_at: string;
};

export type ListingEvolutionStatus =
  | "NO_ACTION"
  | "CANDIDATE_READY"
  | "MANUAL_REVIEW"
  | "BLOCKED_SUPPLIER_TRUST"
  | "BLOCKED_PRICING_PRIMARY"
  | "COOLDOWN"
  | "ATTEMPT_LIMIT_REACHED"
  | "INSUFFICIENT_EVIDENCE"
  | "VERIFICATION_BLOCKED";

export type ListingEvolutionEvaluation = {
  listing_evolution_status: ListingEvolutionStatus;
  listing_evolution_reason: string;
  listing_evolution_candidate_payload: Record<string, unknown> | null;
  listing_evolution_result: string;
  evolution_attempt_increment: boolean;
  last_evolution_at: string | null;
  reason_codes: string[];
};

type RecomputeRow = {
  listingId: string;
  candidateId: string;
  listingStatus: string;
  listingTitle: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  listingDate: Date | string | null;
  performanceImpressions: number | null;
  performanceClicks: number | null;
  performanceOrders: number | null;
  performanceCtr: number | string | null;
  performanceConversionRate: number | string | null;
  evolutionAttemptCount: number | null;
  lastEvolutionAt: Date | string | null;
  listingResponse: unknown;
  supplierTrustScore: number | string | null;
  supplierTrustBand: string | null;
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function textArraySql(values: string[]) {
  return values.length
    ? sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`
    : sql`ARRAY[]::text[]`;
}

function listingAgeDays(listingDate: Date | string | null, now: Date): number | null {
  if (!listingDate) return null;
  const date = listingDate instanceof Date ? listingDate : new Date(String(listingDate));
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

export function evaluateListingKillDecision(input: {
  impressions: number | null;
  clicks: number | null;
  orders: number | null;
  ctr: number | null;
  conversionRate: number | null;
  listingAgeDays: number | null;
  riskAction?: string | null;
  supplierTrustBand?: string | null;
  qualityIssueCount?: number;
  now?: Date;
}): ListingKillEvaluation {
  const now = input.now ?? new Date();
  const reasons = new Set<string>();
  const impressions = Math.max(0, Math.floor(input.impressions ?? 0));
  const clicks = input.clicks == null ? null : Math.max(0, Math.floor(input.clicks));
  const orders = Math.max(0, Math.floor(input.orders ?? 0));
  const ctr = input.ctr;
  const conversionRate = input.conversionRate;
  const ageDays = input.listingAgeDays;
  const qualityIssues = Math.max(0, Number(input.qualityIssueCount ?? 0));

  const weakEvidence = impressions < 120 && (clicks == null || clicks < 8) && orders < 2;
  if (weakEvidence) reasons.add("WEAK_EVIDENCE");

  const sufficientEvidence = impressions >= 250 || (clicks != null && clicks >= 25) || orders >= 3;
  if (sufficientEvidence) reasons.add("SUFFICIENT_EVIDENCE");

  const strongCtr = ctr != null && ctr >= 0.02;
  const poorCtr = ctr != null && ctr <= 0.007;
  const strongConversion = conversionRate != null && conversionRate >= 0.05;
  const poorConversion = conversionRate != null && conversionRate <= 0.015 && (clicks ?? 0) >= 20;

  if (strongCtr) reasons.add("CTR_STRONG");
  if (poorCtr) reasons.add("CTR_WEAK");
  if (strongConversion) reasons.add("CONVERSION_STRONG");
  if (poorConversion) reasons.add("CONVERSION_WEAK");
  if (orders >= 3) reasons.add("ORDERS_PRESENT");

  const riskAction = String(input.riskAction ?? "").trim().toUpperCase();
  if (riskAction === "AUTO_PAUSE") reasons.add("RISK_AUTO_PAUSE_ACTIVE");
  if (riskAction === "MANUAL_REVIEW") reasons.add("RISK_MANUAL_REVIEW_ACTIVE");

  const supplierTrustBand = String(input.supplierTrustBand ?? "").trim().toUpperCase();
  if (supplierTrustBand === "BLOCK") reasons.add("SUPPLIER_TRUST_BLOCK");
  if (supplierTrustBand === "REVIEW") reasons.add("SUPPLIER_TRUST_REVIEW");

  if (qualityIssues >= 2) reasons.add("QUALITY_ISSUES_REPEAT");
  if ((ageDays ?? 0) < 3) reasons.add("LISTING_TOO_NEW");

  let score = 0.5;
  if (strongCtr) score += 0.18;
  if (strongConversion) score += 0.2;
  if (orders >= 3) score += 0.2;
  if (poorCtr) score -= 0.35;
  if (poorConversion) score -= 0.2;
  if (qualityIssues >= 2) score -= 0.12;
  if (supplierTrustBand === "BLOCK") score -= 0.14;
  if (weakEvidence) score += 0.06;

  score = round6(clamp01(score));

  const conflictingEvidence = (strongCtr && poorConversion) || (poorCtr && strongConversion) || (orders >= 2 && poorCtr);
  if (conflictingEvidence) reasons.add("CONFLICTING_SIGNAL_MIX");

  let decision: KillDecision = "KEEP";
  if (weakEvidence || (ageDays != null && ageDays < 3)) {
    decision = conflictingEvidence ? "MANUAL_REVIEW" : "KEEP";
  } else if (conflictingEvidence || riskAction === "MANUAL_REVIEW") {
    decision = "MANUAL_REVIEW";
  } else if (score <= 0.2 && sufficientEvidence && poorCtr && (poorConversion || orders === 0)) {
    decision = "AUTO_KILL";
    reasons.add("DIAGNOSTIC_ONLY_PHASE1");
  } else if ((poorCtr || poorConversion || qualityIssues >= 2) && sufficientEvidence) {
    decision = "EVOLVE_FIRST";
  } else {
    decision = "KEEP";
  }

  if (decision === "AUTO_KILL" && !sufficientEvidence) {
    decision = "MANUAL_REVIEW";
    reasons.add("AUTO_KILL_SUPPRESSED_WEAK_EVIDENCE");
  }

  return {
    kill_score: score,
    kill_decision: decision,
    kill_reason_codes: Array.from(reasons.values()),
    kill_evaluated_at: now.toISOString(),
  };
}

function isPricingPrimaryProblem(listingResponse: Record<string, unknown> | null): boolean {
  const repricing = asObject(listingResponse?.shippingRepricing);
  const action = String(repricing?.action ?? "").trim().toUpperCase();
  return action === "REPRICE" || action === "MANUAL_REVIEW";
}

function normalizeQualityIssueCount(listingResponse: Record<string, unknown> | null): number {
  const payloadGate = asObject(listingResponse?.payloadGate);
  const errors = Array.isArray(payloadGate?.errors) ? payloadGate.errors : [];
  return errors.map((entry) => String(entry ?? "").trim()).filter(Boolean).length;
}

export function evaluateListingEvolutionCandidate(input: {
  kill: ListingKillEvaluation;
  listingTitle: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  impressions: number | null;
  clicks: number | null;
  orders: number | null;
  ctr: number | null;
  conversionRate: number | null;
  evolutionAttemptCount: number;
  lastEvolutionAt: Date | string | null;
  supplierTrustBand?: string | null;
  supplierTrustScore?: number | null;
  listingResponse?: Record<string, unknown> | null;
  now?: Date;
}): ListingEvolutionEvaluation {
  const now = input.now ?? new Date();
  const reasonCodes = new Set<string>();
  const attempts = Math.max(0, input.evolutionAttemptCount);
  const cooldownHours = Math.max(12, Number(process.env.LISTING_EVOLUTION_COOLDOWN_HOURS ?? 72));
  const maxAttempts = Math.max(1, Number(process.env.LISTING_EVOLUTION_MAX_ATTEMPTS ?? 3));
  const lastEvolutionDate =
    input.lastEvolutionAt instanceof Date
      ? input.lastEvolutionAt
      : input.lastEvolutionAt
        ? new Date(String(input.lastEvolutionAt))
        : null;
  const inCooldown =
    !!lastEvolutionDate &&
    !Number.isNaN(lastEvolutionDate.getTime()) &&
    now.getTime() - lastEvolutionDate.getTime() < cooldownHours * 60 * 60 * 1000;

  if (input.kill.kill_decision !== "EVOLVE_FIRST" && input.kill.kill_decision !== "MANUAL_REVIEW") {
    return {
      listing_evolution_status: "NO_ACTION",
      listing_evolution_reason: "kill decision does not require listing evolution",
      listing_evolution_candidate_payload: null,
      listing_evolution_result: "SKIPPED_NO_EVOLUTION_TRIGGER",
      evolution_attempt_increment: false,
      last_evolution_at: null,
      reason_codes: ["KILL_DECISION_NOT_EVOLUTION"],
    };
  }

  const supplierTrustBand = String(input.supplierTrustBand ?? "").trim().toUpperCase();
  if (supplierTrustBand === "BLOCK") {
    return {
      listing_evolution_status: "BLOCKED_SUPPLIER_TRUST",
      listing_evolution_reason: "supplier trust is BLOCK; route listing to manual review",
      listing_evolution_candidate_payload: null,
      listing_evolution_result: "BLOCKED_SUPPLIER_TRUST",
      evolution_attempt_increment: false,
      last_evolution_at: null,
      reason_codes: ["SUPPLIER_TRUST_BLOCK"],
    };
  }

  const listingResponse = input.listingResponse ?? null;
  if (isPricingPrimaryProblem(listingResponse)) {
    return {
      listing_evolution_status: "BLOCKED_PRICING_PRIMARY",
      listing_evolution_reason: "pricing repricing path is primary blocker; evolution candidate skipped",
      listing_evolution_candidate_payload: null,
      listing_evolution_result: "BLOCKED_PRICING_PRIMARY",
      evolution_attempt_increment: false,
      last_evolution_at: null,
      reason_codes: ["PRICING_PRIMARY"],
    };
  }

  if (attempts >= maxAttempts) {
    return {
      listing_evolution_status: "ATTEMPT_LIMIT_REACHED",
      listing_evolution_reason: `bounded attempts reached (${attempts}/${maxAttempts})`,
      listing_evolution_candidate_payload: null,
      listing_evolution_result: "ATTEMPT_LIMIT_REACHED",
      evolution_attempt_increment: false,
      last_evolution_at: null,
      reason_codes: ["ATTEMPT_LIMIT_REACHED"],
    };
  }

  if (inCooldown) {
    return {
      listing_evolution_status: "COOLDOWN",
      listing_evolution_reason: `cooldown active (${cooldownHours}h window)` ,
      listing_evolution_candidate_payload: null,
      listing_evolution_result: "COOLDOWN_ACTIVE",
      evolution_attempt_increment: false,
      last_evolution_at: null,
      reason_codes: ["COOLDOWN_ACTIVE"],
    };
  }

  const impressions = Math.max(0, input.impressions ?? 0);
  const clicks = Math.max(0, input.clicks ?? 0);
  const orders = Math.max(0, input.orders ?? 0);
  const qualityIssues = normalizeQualityIssueCount(listingResponse);
  const ctrWeak = impressions >= 300 && (input.ctr == null || input.ctr <= 0.008) && orders <= 1;
  const conversionWeak = clicks >= 20 && (input.conversionRate == null || input.conversionRate <= 0.02) && orders <= 1;

  if (impressions < 250 && clicks < 15 && orders < 2) {
    return {
      listing_evolution_status: "INSUFFICIENT_EVIDENCE",
      listing_evolution_reason: "listing exposure is insufficient for safe evolution candidate",
      listing_evolution_candidate_payload: null,
      listing_evolution_result: "INSUFFICIENT_EVIDENCE",
      evolution_attempt_increment: false,
      last_evolution_at: null,
      reason_codes: ["INSUFFICIENT_EXPOSURE"],
    };
  }

  const aiListing = asObject(listingResponse?.aiListing);
  const verification = asObject(aiListing?.verification);
  const verificationOk = verification?.ok === true;
  if (verification && !verificationOk) {
    return {
      listing_evolution_status: "VERIFICATION_BLOCKED",
      listing_evolution_reason: "existing AI listing verification is failing; correction-only operator review required",
      listing_evolution_candidate_payload: {
        candidateType: "CORRECTION_ONLY",
        requiresVerification: true,
        requiresPreviewValidation: true,
      },
      listing_evolution_result: "VERIFICATION_BLOCKED",
      evolution_attempt_increment: false,
      last_evolution_at: null,
      reason_codes: ["VERIFY_LISTING_PACK_FAILED"],
    };
  }

  let candidateType: "TITLE_IMAGE" | "POSITIONING_CONTENT" | "CORRECTION_ONLY" | null = null;
  const changes: string[] = [];

  if (qualityIssues >= 2) {
    candidateType = "CORRECTION_ONLY";
    reasonCodes.add("QUALITY_ISSUES_REPEAT");
    changes.push("correct verification/payload gate issues only");
  } else if (ctrWeak) {
    candidateType = "TITLE_IMAGE";
    reasonCodes.add("CTR_WEAK_HIGH_IMPRESSIONS");
    changes.push("optimize title");
    changes.push("re-order images (bounded)");
  } else if (conversionWeak) {
    candidateType = "POSITIONING_CONTENT";
    reasonCodes.add("CONVERSION_WEAK_WITH_CLICKS");
    changes.push("improve description and value positioning");
  }

  if (!candidateType) {
    return {
      listing_evolution_status: "MANUAL_REVIEW",
      listing_evolution_reason: "underperformance exists but candidate shape is ambiguous",
      listing_evolution_candidate_payload: null,
      listing_evolution_result: "MANUAL_REVIEW_AMBIGUOUS",
      evolution_attempt_increment: false,
      last_evolution_at: null,
      reason_codes: ["AMBIGUOUS_CANDIDATE_SHAPE"],
    };
  }

  const optimizedTitle =
    candidateType === "TITLE_IMAGE"
      ? optimizeListingTitle({
          marketplaceTitle: input.listingTitle,
          supplierTitle: input.listingTitle,
          supplierKey: input.supplierKey ?? "unknown",
          supplierProductId: input.supplierProductId ?? "unknown",
        })
      : null;

  const candidatePayload: Record<string, unknown> = {
    phase: "PHASE1_READ_ONLY",
    candidateType,
    generatedAt: now.toISOString(),
    requiresVerification: true,
    requiresPreviewValidation: true,
    boundedEdits: true,
    supplierTrustBand: supplierTrustBand || null,
    supplierTrustScore: input.supplierTrustScore ?? null,
    sourceMetrics: {
      impressions,
      clicks,
      orders,
      ctr: input.ctr ?? null,
      conversionRate: input.conversionRate ?? null,
      killDecision: input.kill.kill_decision,
    },
    proposedChanges: changes,
    optimizedTitle,
  };

  return {
    listing_evolution_status: "CANDIDATE_READY",
    listing_evolution_reason: `generated ${candidateType} evolution candidate for operator review`,
    listing_evolution_candidate_payload: candidatePayload,
    listing_evolution_result: "CANDIDATE_READY",
    evolution_attempt_increment: true,
    last_evolution_at: now.toISOString(),
    reason_codes: Array.from(reasonCodes.values()),
  };
}

export async function recomputeListingPhase1Diagnostics(input: {
  listingId: string;
  actorId: string;
  actorType: "ADMIN" | "WORKER" | "SYSTEM";
}): Promise<{ ok: boolean; reason?: string; listingId: string; kill: ListingKillEvaluation | null; evolution: ListingEvolutionEvaluation | null }> {
  const listingId = String(input.listingId ?? "").trim();
  if (!listingId) {
    return { ok: false, reason: "listingId required", listingId, kill: null, evolution: null };
  }

  const rows = await db.execute<RecomputeRow>(sql`
    SELECT
      l.id AS "listingId",
      l.candidate_id AS "candidateId",
      l.status AS "listingStatus",
      l.title AS "listingTitle",
      l.supplier_key AS "supplierKey",
      l.supplier_product_id AS "supplierProductId",
      l.listing_date AS "listingDate",
      l.performance_impressions AS "performanceImpressions",
      l.performance_clicks AS "performanceClicks",
      l.performance_orders AS "performanceOrders",
      l.performance_ctr AS "performanceCtr",
      l.performance_conversion_rate AS "performanceConversionRate",
      l.evolution_attempt_count AS "evolutionAttemptCount",
      l.last_evolution_at AS "lastEvolutionAt",
      l.response AS "listingResponse",
      pc.supplier_trust_score AS "supplierTrustScore",
      pc.supplier_trust_band AS "supplierTrustBand"
    FROM listings l
    LEFT JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.id = ${listingId}
    LIMIT 1
  `);

  const row = rows.rows?.[0];
  if (!row) {
    return { ok: false, reason: "listing not found", listingId, kill: null, evolution: null };
  }

  const listingResponse = asObject(row.listingResponse);
  const inventoryRisk = asObject(listingResponse?.inventoryRisk);
  const qualityIssueCount = normalizeQualityIssueCount(listingResponse);
  const kill = evaluateListingKillDecision({
    impressions: row.performanceImpressions,
    clicks: row.performanceClicks,
    orders: row.performanceOrders,
    ctr: toNumber(row.performanceCtr),
    conversionRate: toNumber(row.performanceConversionRate),
    listingAgeDays: listingAgeDays(row.listingDate, new Date()),
    riskAction: typeof inventoryRisk?.action === "string" ? inventoryRisk.action : null,
    supplierTrustBand: row.supplierTrustBand,
    qualityIssueCount,
  });

  const evolution = evaluateListingEvolutionCandidate({
    kill,
    listingTitle: row.listingTitle,
    supplierKey: row.supplierKey,
    supplierProductId: row.supplierProductId,
    impressions: row.performanceImpressions,
    clicks: row.performanceClicks,
    orders: row.performanceOrders,
    ctr: toNumber(row.performanceCtr),
    conversionRate: toNumber(row.performanceConversionRate),
    evolutionAttemptCount: Math.max(0, Number(row.evolutionAttemptCount ?? 0)),
    lastEvolutionAt: row.lastEvolutionAt,
    supplierTrustBand: row.supplierTrustBand,
    supplierTrustScore: toNumber(row.supplierTrustScore),
    listingResponse,
  });
  const killReasonCodesSql = textArraySql(kill.kill_reason_codes);
  const phase1DiagnosticsPayload = JSON.stringify({
    kill: {
      score: kill.kill_score,
      decision: kill.kill_decision,
      reasonCodes: kill.kill_reason_codes,
      evaluatedAt: kill.kill_evaluated_at,
    },
    evolution: {
      status: evolution.listing_evolution_status,
      reason: evolution.listing_evolution_reason,
      result: evolution.listing_evolution_result,
      hasCandidate: evolution.listing_evolution_candidate_payload != null,
    },
  });

  await db.execute(sql`
    UPDATE listings
    SET
      kill_score = ${kill.kill_score},
      kill_decision = ${kill.kill_decision},
      kill_reason_codes = ${killReasonCodesSql},
      kill_evaluated_at = ${kill.kill_evaluated_at},
      listing_evolution_status = ${evolution.listing_evolution_status},
      listing_evolution_reason = ${evolution.listing_evolution_reason},
      listing_evolution_candidate_payload = ${evolution.listing_evolution_candidate_payload},
      listing_evolution_result = ${evolution.listing_evolution_result},
      evolution_attempt_count = CASE
        WHEN ${evolution.evolution_attempt_increment} THEN COALESCE(evolution_attempt_count, 0) + 1
        ELSE COALESCE(evolution_attempt_count, 0)
      END,
      last_evolution_at = CASE
        WHEN ${evolution.last_evolution_at}::text IS NOT NULL THEN ${evolution.last_evolution_at}
        ELSE last_evolution_at
      END,
      updated_at = NOW(),
      response = COALESCE(response, '{}'::jsonb) || jsonb_build_object(
        'phase1Diagnostics',
        ${phase1DiagnosticsPayload}::jsonb
      )
    WHERE id = ${listingId}
  `);

  await writeAuditLog({
    actorType: input.actorType,
    actorId: input.actorId,
    entityType: "LISTING",
    entityId: listingId,
    eventType: "LISTING_PHASE1_DIAGNOSTICS_RECOMPUTED",
    details: {
      listingId,
      kill,
      evolution: {
        status: evolution.listing_evolution_status,
        reason: evolution.listing_evolution_reason,
        result: evolution.listing_evolution_result,
        reasonCodes: evolution.reason_codes,
        hasCandidate: Boolean(evolution.listing_evolution_candidate_payload),
      },
      diagnosticOnly: true,
      noAutoKill: true,
      noAutoEvolve: true,
    },
  });

  return { ok: true, listingId, kill, evolution };
}
