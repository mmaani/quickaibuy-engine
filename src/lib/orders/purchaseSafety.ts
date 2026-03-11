import { validateProfitSafety } from "@/lib/profit/priceGuard";
import type { AdminOrderDetail } from "./getAdminOrdersPageData";

export type OrderPurchaseSafetyStatusCode =
  | "VALIDATION_NEEDED"
  | "BLOCKED_STALE_DATA"
  | "BLOCKED_SUPPLIER_DRIFT"
  | "MANUAL_REVIEW_REQUIRED"
  | "READY_FOR_PURCHASE_REVIEW";

export type OrderPurchaseSafetyStatus = {
  status: OrderPurchaseSafetyStatusCode;
  label: string;
  technicalLabel: string;
  hint: string;
  secondaryHint: string | null;
  manualReviewRequired: boolean;
  checkedAt: string | null;
  reasons: string[];
  candidateId: string | null;
  listingId: string | null;
  futureExecutionHook: "REQUIRE_FRESH_SUPPLIER_VALIDATION";
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function pickCandidateLink(detail: AdminOrderDetail): { candidateId: string | null; listingId: string | null } {
  for (const item of detail.items) {
    const candidateId = String(item.candidateId ?? "").trim();
    if (!candidateId) continue;
    const listingId = String(item.listingId ?? "").trim() || null;
    return { candidateId, listingId };
  }
  return { candidateId: null, listingId: null };
}

function statusFromReasons(reasons: string[]): OrderPurchaseSafetyStatusCode {
  const hasStale =
    reasons.includes("STALE_SUPPLIER_SNAPSHOT") || reasons.includes("STALE_MARKETPLACE_SNAPSHOT");
  if (hasStale) return "BLOCKED_STALE_DATA";

  const hasDrift =
    reasons.includes("SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE") ||
    reasons.includes("SUPPLIER_DRIFT_DATA_UNAVAILABLE");
  if (hasDrift) return "BLOCKED_SUPPLIER_DRIFT";

  if (reasons.length > 0) return "MANUAL_REVIEW_REQUIRED";
  return "READY_FOR_PURCHASE_REVIEW";
}

function mapStatusPresentation(status: OrderPurchaseSafetyStatusCode): {
  label: string;
  technicalLabel: string;
  hint: string;
  secondaryHint: string | null;
  manualReviewRequired: boolean;
} {
  if (status === "READY_FOR_PURCHASE_REVIEW") {
    return {
      label: "Ready for purchase review",
      technicalLabel: "PRICE_GUARD_ALLOW",
      hint: "Manual review is still required before any purchase step.",
      secondaryHint: "Re-check supplier price before future auto-purchase execution.",
      manualReviewRequired: true,
    };
  }

  if (status === "BLOCKED_STALE_DATA") {
    return {
      label: "Supplier data may be stale",
      technicalLabel: "STALE_SNAPSHOT_BLOCK",
      hint: "Validation needed before purchase.",
      secondaryHint: "Refresh data, then re-check supplier price before purchase.",
      manualReviewRequired: true,
    };
  }

  if (status === "BLOCKED_SUPPLIER_DRIFT") {
    return {
      label: "Supplier product changed",
      technicalLabel: "SUPPLIER_DRIFT_BLOCK",
      hint: "Manual review required.",
      secondaryHint: "Re-check supplier price before purchase.",
      manualReviewRequired: true,
    };
  }

  if (status === "MANUAL_REVIEW_REQUIRED") {
    return {
      label: "Manual review required",
      technicalLabel: "PRICE_GUARD_MANUAL_REVIEW",
      hint: "Validation needed before purchase.",
      secondaryHint: "Re-check supplier price and availability before purchase.",
      manualReviewRequired: true,
    };
  }

  return {
    label: "Validation needed before purchase",
    technicalLabel: "VALIDATION_NOT_RUN",
    hint: "Manual review required.",
    secondaryHint: "Link order to listing candidate, then run a fresh safety check.",
    manualReviewRequired: true,
  };
}

export async function getOrderPurchaseSafetyStatus(
  detail: AdminOrderDetail
): Promise<OrderPurchaseSafetyStatus> {
  const link = pickCandidateLink(detail);
  if (!link.candidateId) {
    const presentation = mapStatusPresentation("VALIDATION_NEEDED");
    return {
      status: "VALIDATION_NEEDED",
      label: presentation.label,
      technicalLabel: presentation.technicalLabel,
      hint: presentation.hint,
      secondaryHint: presentation.secondaryHint,
      manualReviewRequired: presentation.manualReviewRequired,
      checkedAt: null,
      reasons: ["ORDER_CANDIDATE_LINK_REQUIRED"],
      candidateId: null,
      listingId: null,
      futureExecutionHook: "REQUIRE_FRESH_SUPPLIER_VALIDATION",
    };
  }

  try {
    // Hook contract for future supplier automation:
    // purchase execution must call this fresh safety validation at execution time.
    const priceGuard = await validateProfitSafety({
      candidateId: link.candidateId,
      listingId: link.listingId,
      mode: "order",
    });
    const reasons = uniqueStrings(priceGuard.reasons);
    const status = priceGuard.allow ? "READY_FOR_PURCHASE_REVIEW" : statusFromReasons(reasons);
    const presentation = mapStatusPresentation(status);

    return {
      status,
      label: presentation.label,
      technicalLabel: presentation.technicalLabel,
      hint: presentation.hint,
      secondaryHint: presentation.secondaryHint,
      manualReviewRequired: presentation.manualReviewRequired,
      checkedAt: new Date().toISOString(),
      reasons,
      candidateId: link.candidateId,
      listingId: link.listingId,
      futureExecutionHook: "REQUIRE_FRESH_SUPPLIER_VALIDATION",
    };
  } catch {
    const presentation = mapStatusPresentation("VALIDATION_NEEDED");
    return {
      status: "VALIDATION_NEEDED",
      label: presentation.label,
      technicalLabel: presentation.technicalLabel,
      hint: presentation.hint,
      secondaryHint: "Safety check could not run. Retry before purchase review.",
      manualReviewRequired: true,
      checkedAt: null,
      reasons: ["ORDER_SAFETY_CHECK_FAILED"],
      candidateId: link.candidateId,
      listingId: link.listingId,
      futureExecutionHook: "REQUIRE_FRESH_SUPPLIER_VALIDATION",
    };
  }
}
