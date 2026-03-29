import type { EvidenceContractRule, EvidenceType, LearningEvidenceRecord, ValidationStatus } from "@/lib/learningHub/types";

const CONTRACTS: Record<EvidenceType, EvidenceContractRule> = {
  supplier_snapshot: {
    requiredFields: ["entityType", "entityId", "source"],
    maxFreshnessSeconds: 60 * 60 * 24 * 2,
    minConfidence: 0.5,
  },
  marketplace_snapshot: {
    requiredFields: ["entityType", "entityId", "marketplaceKey", "source"],
    maxFreshnessSeconds: 60 * 60 * 24,
    minConfidence: 0.6,
  },
  shipping_quote: {
    requiredFields: ["entityType", "entityId", "supplierKey", "source"],
    maxFreshnessSeconds: 60 * 60 * 24 * 3,
    minConfidence: 0.6,
  },
  stock_signal: {
    requiredFields: ["entityType", "entityId", "supplierKey", "source"],
    maxFreshnessSeconds: 60 * 60 * 6,
    minConfidence: 0.55,
  },
  match: {
    requiredFields: ["entityType", "entityId", "supplierKey", "marketplaceKey", "source"],
    maxFreshnessSeconds: 60 * 60 * 24 * 2,
    minConfidence: 0.7,
  },
  candidate_decision: {
    requiredFields: ["entityType", "entityId", "source", "downstreamOutcome"],
    maxFreshnessSeconds: 60 * 60 * 24 * 3,
    minConfidence: 0.7,
  },
  listing_decision: {
    requiredFields: ["entityType", "entityId", "source", "downstreamOutcome"],
    maxFreshnessSeconds: 60 * 60 * 24 * 7,
    minConfidence: 0.7,
  },
  publish_outcome: {
    requiredFields: ["entityType", "entityId", "marketplaceKey", "source", "downstreamOutcome"],
    maxFreshnessSeconds: 60 * 60 * 24 * 14,
    minConfidence: 0.7,
  },
  order_outcome: {
    requiredFields: ["entityType", "entityId", "source", "downstreamOutcome"],
    maxFreshnessSeconds: 60 * 60 * 24 * 30,
    minConfidence: 0.65,
  },
};

export function evaluateEvidenceContracts(evidence: LearningEvidenceRecord): {
  status: ValidationStatus;
  blockedReasons: string[];
} {
  const contract = CONTRACTS[evidence.evidenceType];
  const blockedReasons = [...(evidence.blockedReasons ?? [])];

  for (const field of contract.requiredFields) {
    const value = (evidence as Record<string, unknown>)[field];
    if (value == null || (typeof value === "string" && value.trim().length === 0)) {
      blockedReasons.push(`MISSING_REQUIRED_FIELD:${field}`);
    }
  }

  if (
    contract.maxFreshnessSeconds != null &&
    evidence.freshnessSeconds != null &&
    evidence.freshnessSeconds > contract.maxFreshnessSeconds
  ) {
    blockedReasons.push(`STALE_EVIDENCE:${evidence.freshnessSeconds}`);
  }

  if (contract.minConfidence != null && evidence.confidence != null && evidence.confidence < contract.minConfidence) {
    blockedReasons.push(`WEAK_CONFIDENCE:${evidence.confidence.toFixed(3)}`);
  }

  const hasHardBlock = blockedReasons.some((reason) =>
    reason.startsWith("MISSING_REQUIRED_FIELD") ||
    reason.startsWith("STALE_EVIDENCE") ||
    reason.startsWith("CONTRADICTION")
  );

  if (hasHardBlock) return { status: "FAIL", blockedReasons };
  if (blockedReasons.length > 0) return { status: "WARN", blockedReasons };
  return { status: "PASS", blockedReasons: [] };
}
