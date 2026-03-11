import { LISTING_STATUSES } from "./statuses";

export type RecoveryState =
  | "NONE"
  | "BLOCKED_STALE_MARKETPLACE"
  | "BLOCKED_SUPPLIER_DRIFT"
  | "BLOCKED_STALE_SUPPLIER"
  | "BLOCKED_OTHER_FAIL_CLOSED"
  | "READY_FOR_REEVALUATION"
  | "READY_FOR_REPROMOTION";

export type RecoveryStateSummary = {
  recoveryState: RecoveryState;
  recoveryNextAction: string;
  recoveryBlockReasonCode: string | null;
  recoveryReasonCodes: string[];
  reEvaluationNeeded: boolean;
  rePromotionReady: boolean;
};

function normalizeCodesFromBlockReason(listingBlockReason: string | null | undefined): string[] {
  const raw = String(listingBlockReason ?? "").trim();
  if (!raw) return [];
  const colonIndex = raw.indexOf(":");
  const reasonBody = colonIndex >= 0 ? raw.slice(colonIndex + 1) : raw;
  return reasonBody
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

function findPrimaryRecoveryCode(codes: string[]): string | null {
  if (codes.includes("STALE_MARKETPLACE_SNAPSHOT")) return "STALE_MARKETPLACE_SNAPSHOT";
  if (codes.includes("SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE")) return "SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE";
  if (codes.includes("SUPPLIER_DRIFT_DATA_UNAVAILABLE")) return "SUPPLIER_DRIFT_DATA_UNAVAILABLE";
  if (codes.includes("SUPPLIER_DRIFT_DATA_REQUIRED")) return "SUPPLIER_DRIFT_DATA_REQUIRED";
  if (codes.includes("STALE_SUPPLIER_SNAPSHOT")) return "STALE_SUPPLIER_SNAPSHOT";
  if (codes.includes("SUPPLIER_SNAPSHOT_AGE_REQUIRED")) return "SUPPLIER_SNAPSHOT_AGE_REQUIRED";
  return codes[0] ?? null;
}

export function computeRecoveryState(input: {
  decisionStatus: string | null | undefined;
  listingEligible: boolean;
  listingStatus: string | null | undefined;
  listingBlockReason: string | null | undefined;
}): RecoveryStateSummary {
  const decisionStatus = String(input.decisionStatus ?? "").toUpperCase();
  const listingStatus = String(input.listingStatus ?? "").toUpperCase();
  const reasonCodes = normalizeCodesFromBlockReason(input.listingBlockReason);
  const primaryCode = findPrimaryRecoveryCode(reasonCodes);

  if (reasonCodes.includes("STALE_MARKETPLACE_SNAPSHOT")) {
    return {
      recoveryState: "BLOCKED_STALE_MARKETPLACE",
      recoveryNextAction: "Refresh marketplace data and run explicit re-evaluation.",
      recoveryBlockReasonCode: primaryCode,
      recoveryReasonCodes: reasonCodes,
      reEvaluationNeeded: true,
      rePromotionReady: false,
    };
  }

  if (
    reasonCodes.includes("SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE") ||
    reasonCodes.includes("SUPPLIER_DRIFT_DATA_UNAVAILABLE") ||
    reasonCodes.includes("SUPPLIER_DRIFT_DATA_REQUIRED")
  ) {
    return {
      recoveryState: "BLOCKED_SUPPLIER_DRIFT",
      recoveryNextAction: "Refresh supplier data and run explicit re-evaluation.",
      recoveryBlockReasonCode: primaryCode,
      recoveryReasonCodes: reasonCodes,
      reEvaluationNeeded: true,
      rePromotionReady: false,
    };
  }

  if (
    reasonCodes.includes("STALE_SUPPLIER_SNAPSHOT") ||
    reasonCodes.includes("SUPPLIER_SNAPSHOT_AGE_REQUIRED")
  ) {
    return {
      recoveryState: "BLOCKED_STALE_SUPPLIER",
      recoveryNextAction: "Refresh supplier snapshot and run explicit re-evaluation.",
      recoveryBlockReasonCode: primaryCode,
      recoveryReasonCodes: reasonCodes,
      reEvaluationNeeded: true,
      rePromotionReady: false,
    };
  }

  if (decisionStatus === "MANUAL_REVIEW" && !input.listingEligible) {
    return {
      recoveryState: "READY_FOR_REEVALUATION",
      recoveryNextAction: "Run explicit re-evaluation.",
      recoveryBlockReasonCode: primaryCode,
      recoveryReasonCodes: reasonCodes,
      reEvaluationNeeded: true,
      rePromotionReady: false,
    };
  }

  if (
    decisionStatus === "APPROVED" &&
    input.listingEligible &&
    listingStatus === LISTING_STATUSES.PREVIEW
  ) {
    return {
      recoveryState: "READY_FOR_REPROMOTION",
      recoveryNextAction: "Operator can promote PREVIEW to READY_TO_PUBLISH.",
      recoveryBlockReasonCode: primaryCode,
      recoveryReasonCodes: reasonCodes,
      reEvaluationNeeded: false,
      rePromotionReady: true,
    };
  }

  if (!input.listingEligible && reasonCodes.length > 0) {
    return {
      recoveryState: "BLOCKED_OTHER_FAIL_CLOSED",
      recoveryNextAction: "Run explicit re-evaluation and review block reasons.",
      recoveryBlockReasonCode: primaryCode,
      recoveryReasonCodes: reasonCodes,
      reEvaluationNeeded: true,
      rePromotionReady: false,
    };
  }

  return {
    recoveryState: "NONE",
    recoveryNextAction: "No recovery action required.",
    recoveryBlockReasonCode: primaryCode,
    recoveryReasonCodes: reasonCodes,
    reEvaluationNeeded: false,
    rePromotionReady: false,
  };
}
