import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { getLearningHubScorecard } from "@/lib/learningHub/scorecard";

type EnforcementSeverity = "HIGH" | "CRITICAL";

export class CanonicalEnforcementError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "CanonicalEnforcementError";
    this.code = code;
    this.details = details;
  }
}

let learningHubCache:
  | {
      expiresAt: number;
      scorecard: Awaited<ReturnType<typeof getLearningHubScorecard>>;
    }
  | null = null;

async function getCachedLearningHubScorecard() {
  const now = Date.now();
  if (learningHubCache && learningHubCache.expiresAt > now) {
    return learningHubCache.scorecard;
  }

  const scorecard = await getLearningHubScorecard();
  learningHubCache = {
    scorecard,
    expiresAt: now + 60_000,
  };

  return scorecard;
}

async function logEnforcementViolation(input: {
  code: string;
  blockedAction: string;
  path: string;
  reason: string;
  actorId?: string;
  actorType?: "ADMIN" | "WORKER" | "SYSTEM";
  severity?: EnforcementSeverity;
  details?: Record<string, unknown>;
}) {
  await writeAuditLog({
    actorType: input.actorType ?? "SYSTEM",
    actorId: input.actorId ?? "canonical-enforcement",
    entityType: "CONTROL_PLANE",
    entityId: "canonical-execution-enforcement",
    eventType: "CANONICAL_ENFORCEMENT_BLOCKED",
    details: {
      code: input.code,
      severity: input.severity ?? "CRITICAL",
      violationType: "canonical_execution_violation",
      blockedAction: input.blockedAction,
      executionPath: input.path,
      reason: input.reason,
      ...(input.details ?? {}),
    },
  });
}

export async function assertLearningHubReady(input: {
  blockedAction: string;
  path: string;
  actorId?: string;
  actorType?: "ADMIN" | "WORKER" | "SYSTEM";
  requiredDomains?: string[];
}) {
  const scorecard = await getCachedLearningHubScorecard();
  const requiredDomains = new Set(input.requiredDomains ?? []);

  if (!scorecard) {
    const reason = "learning hub scorecard unavailable";
    await logEnforcementViolation({
      code: "LEARNING_HUB_UNAVAILABLE",
      blockedAction: input.blockedAction,
      path: input.path,
      reason,
      actorId: input.actorId,
      actorType: input.actorType,
    });
    throw new CanonicalEnforcementError("LEARNING_HUB_UNAVAILABLE", reason, {
      blockedAction: input.blockedAction,
      path: input.path,
    });
  }

  const missingRequiredDomains = scorecard.freshness.domains
    .filter((domain) => requiredDomains.has(domain.key) && domain.state !== "fresh")
    .map((domain) => domain.key);

  const criticalReasons = [
    ...(scorecard.openDrift.critical > 0 ? ["CRITICAL_DRIFT_PRESENT"] : []),
    ...scorecard.freshness.autonomyPauseReasons,
    ...(missingRequiredDomains.length > 0
      ? [`REQUIRED_DOMAINS_NOT_FRESH:${missingRequiredDomains.join(",")}`]
      : []),
    ...(scorecard.evidence.total <= 0 ? ["LEARNING_EVIDENCE_MISSING"] : []),
    ...(scorecard.features.total <= 0 ? ["LEARNING_FEATURES_MISSING"] : []),
  ];

  if (criticalReasons.length > 0) {
    const reason = `learning hub enforcement blocked: ${criticalReasons.join(" | ")}`;
    await logEnforcementViolation({
      code: "LEARNING_HUB_NOT_READY",
      blockedAction: input.blockedAction,
      path: input.path,
      reason,
      actorId: input.actorId,
      actorType: input.actorType,
      details: {
        criticalDriftCount: scorecard.openDrift.critical,
        staleDomainCount: scorecard.freshness.staleDomainCount,
        warningDomainCount: scorecard.freshness.warningDomainCount,
        autonomyPauseReasons: scorecard.freshness.autonomyPauseReasons,
        requiredDomains: Array.from(requiredDomains),
        missingRequiredDomains,
      },
    });
    throw new CanonicalEnforcementError("LEARNING_HUB_NOT_READY", reason, {
      blockedAction: input.blockedAction,
      path: input.path,
      criticalReasons,
    });
  }
}

export async function assertPublishExecutionContext(input: {
  blockedAction: string;
  path: string;
  actorId?: string;
  actorType?: "ADMIN" | "WORKER" | "SYSTEM";
  viaWorkerJob: boolean;
  viaBackbone: boolean;
  viaControlPlane: boolean;
}) {
  const violations: string[] = [];
  if (!input.viaWorkerJob) violations.push("WORKER_REQUIRED");
  if (!input.viaBackbone) violations.push("BACKBONE_REQUIRED");
  if (!input.viaControlPlane) violations.push("CONTROL_PLANE_REQUIRED");

  if (violations.length > 0) {
    const reason = `publish hard lock blocked: ${violations.join(" | ")}`;
    await logEnforcementViolation({
      code: "PUBLISH_CONTEXT_VIOLATION",
      blockedAction: input.blockedAction,
      path: input.path,
      reason,
      actorId: input.actorId,
      actorType: input.actorType,
      details: {
        viaWorkerJob: input.viaWorkerJob,
        viaBackbone: input.viaBackbone,
        viaControlPlane: input.viaControlPlane,
      },
    });
    throw new CanonicalEnforcementError("PUBLISH_CONTEXT_VIOLATION", reason, {
      blockedAction: input.blockedAction,
      path: input.path,
      violations,
    });
  }
}

export async function assertControlledMutationContext(input: {
  blockedAction: string;
  path: string;
  actorId?: string;
  actorType?: "ADMIN" | "WORKER" | "SYSTEM";
  viaWorkerJob: boolean;
  controlledRepairPath: boolean;
}) {
  if (input.viaWorkerJob || input.controlledRepairPath) return;

  const reason = "mutation hard lock blocked: worker execution or controlled repair path required";
  await logEnforcementViolation({
    code: "MUTATION_CONTEXT_VIOLATION",
    blockedAction: input.blockedAction,
    path: input.path,
    reason,
    actorId: input.actorId,
    actorType: input.actorType,
    severity: "HIGH",
    details: {
      viaWorkerJob: input.viaWorkerJob,
      controlledRepairPath: input.controlledRepairPath,
    },
  });
  throw new CanonicalEnforcementError("MUTATION_CONTEXT_VIOLATION", reason, {
    blockedAction: input.blockedAction,
    path: input.path,
  });
}
