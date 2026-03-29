export type EvidenceType =
  | "supplier_snapshot"
  | "marketplace_snapshot"
  | "shipping_quote"
  | "stock_signal"
  | "match"
  | "candidate_decision"
  | "listing_decision"
  | "publish_outcome"
  | "order_outcome";

export type ValidationStatus = "PASS" | "WARN" | "FAIL";

export type LearningEvidenceRecord = {
  evidenceType: EvidenceType;
  entityType: string;
  entityId: string;
  supplierKey?: string | null;
  marketplaceKey?: string | null;
  source: string;
  parserVersion?: string | null;
  confidence?: number | null;
  freshnessSeconds?: number | null;
  validationStatus: ValidationStatus;
  blockedReasons?: string[];
  downstreamOutcome?: string | null;
  diagnostics?: Record<string, unknown> | null;
  observedAt?: Date;
};

export type EvidenceContractRule = {
  requiredFields: string[];
  maxFreshnessSeconds?: number;
  minConfidence?: number;
};

export type DriftSeverity = "info" | "warning" | "critical";

export type DriftCategory =
  | "payload_drift"
  | "missingness_drift"
  | "parser_yield_drift"
  | "supplier_instability"
  | "freshness_failure"
  | "shipping_ratio_regression"
  | "stock_ratio_regression"
  | "evidence_quality_degradation"
  | "candidate_pool_degradation";
