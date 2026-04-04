import { validateProfitSafety } from "@/lib/profit/priceGuard";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { evaluatePinnedSupplierSafety, normalizeSupplierStockStatus } from "@/lib/safety/supplierLinkage";
import { hasExactPinnedSupplierIdentityMatch } from "./pinnedSupplierIdentity";
import { createOrderEvent } from "./orderEvents";
import { getAdminOrderDetail, type AdminOrderDetail } from "./getAdminOrdersPageData";
import { getCjProofBlockingReason, isCjProofPurchaseSafe, readCjProofStateFromRawPayload } from "@/lib/suppliers/cj";

export type OrderPurchaseSafetyStatusCode =
  | "VALIDATION_NEEDED"
  | "BLOCKED_SUPPLIER_LINKAGE_REQUIRED"
  | "BLOCKED_STALE_DATA"
  | "BLOCKED_SUPPLIER_DRIFT"
  | "BLOCKED_ECONOMICS_OUT_OF_BOUNDS"
  | "BLOCKED_CJ_PROOF_REQUIRED"
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
  economics_hard_pass: boolean;
  economics_block_reason: string | null;
  economics_verified_at: string | null;
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

function hasSupplierLinkage(detail: AdminOrderDetail): boolean {
  return detail.items.some((item) => {
    const supplierKey = String(item.supplierKey ?? "").trim();
    const supplierProductId = String(item.supplierProductId ?? "").trim();
    return Boolean(supplierKey && supplierProductId);
  });
}

function statusFromReasons(reasons: string[]): OrderPurchaseSafetyStatusCode {
  if (
    reasons.includes("ORDER_SUPPLIER_LINKAGE_REQUIRED") ||
    reasons.includes("MISSING_SUPPLIER_PRODUCT_ID") ||
    reasons.includes("MISSING_SUPPLIER_KEY") ||
    reasons.includes("NON_DETERMINISTIC_LINKAGE") ||
    reasons.includes("SUPPLIER_LINK_NOT_LOCKED")
  ) {
    return "BLOCKED_SUPPLIER_LINKAGE_REQUIRED";
  }

  const hasStale =
    reasons.includes("STALE_SUPPLIER_SNAPSHOT") || reasons.includes("STALE_MARKETPLACE_SNAPSHOT");
  if (hasStale) return "BLOCKED_STALE_DATA";

  const hasDrift =
    reasons.includes("SUPPLIER_PRICE_DRIFT_EXCEEDS_TOLERANCE") ||
    reasons.includes("SUPPLIER_DRIFT_DATA_UNAVAILABLE");
  if (hasDrift) return "BLOCKED_SUPPLIER_DRIFT";

  const hasEconomicsBlock =
    reasons.includes("PROFIT_BELOW_MINIMUM") ||
    reasons.includes("MARGIN_BELOW_MINIMUM") ||
    reasons.includes("ROI_BELOW_MINIMUM") ||
    reasons.includes("INCOMPLETE_ECONOMICS") ||
    reasons.includes("MISSING_SUPPLIER_PRICE") ||
    reasons.includes("MISSING_MARKETPLACE_PRICE") ||
    reasons.includes("MISSING_SHIPPING_DATA") ||
    reasons.includes("MISSING_FEE_ASSUMPTIONS");
  if (hasEconomicsBlock) return "BLOCKED_ECONOMICS_OUT_OF_BOUNDS";

  const hasCjProofBlock =
    reasons.includes("CJ_PROOF_STATE_MISSING") ||
    reasons.includes("CJ_FREIGHT_UNPROVEN") ||
    reasons.includes("CJ_STOCK_UNPROVEN") ||
    reasons.includes("CJ_ORDER_CREATE_UNPROVEN") ||
    reasons.includes("CJ_ORDER_DETAIL_UNPROVEN") ||
    reasons.includes("CJ_PROOF_PURCHASE_BLOCK");
  if (hasCjProofBlock) return "BLOCKED_CJ_PROOF_REQUIRED";

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
      label: "Checked - pass",
      technicalLabel: "PRICE_GUARD_ALLOW",
      hint: "Manual review is still required before any purchase step.",
      secondaryHint: "Re-check supplier price before future auto-purchase execution.",
      manualReviewRequired: true,
    };
  }

  if (status === "BLOCKED_STALE_DATA") {
    return {
      label: "Blocked - stale supplier data",
      technicalLabel: "STALE_SNAPSHOT_BLOCK",
      hint: "Validation needed before purchase.",
      secondaryHint: "Refresh data, then re-check supplier price before purchase.",
      manualReviewRequired: true,
    };
  }

  if (status === "BLOCKED_SUPPLIER_LINKAGE_REQUIRED") {
    return {
      label: "Blocked - supplier linkage required",
      technicalLabel: "SUPPLIER_LINKAGE_BLOCK",
      hint: "Auto purchase must stay blocked until the order resolves to a supplier and supplier product.",
      secondaryHint: "Re-sync order linkage from listing preview or repair candidate linkage before purchase approval.",
      manualReviewRequired: true,
    };
  }

  if (status === "BLOCKED_SUPPLIER_DRIFT") {
    return {
      label: "Blocked - supplier drift",
      technicalLabel: "SUPPLIER_DRIFT_BLOCK",
      hint: "Manual review required.",
      secondaryHint: "Re-check supplier price before purchase.",
      manualReviewRequired: true,
    };
  }

  if (status === "BLOCKED_ECONOMICS_OUT_OF_BOUNDS") {
    return {
      label: "Blocked - economics out of bounds",
      technicalLabel: "ECONOMICS_BLOCK",
      hint: "Manual review required.",
      secondaryHint: "Do not approve purchase until economics are safe.",
      manualReviewRequired: true,
    };
  }

  if (status === "BLOCKED_CJ_PROOF_REQUIRED") {
    return {
      label: "Blocked - CJ proof required",
      technicalLabel: "CJ_PROOF_BLOCK",
      hint: "CJ purchase proof is incomplete, so supplier purchase must stay blocked.",
      secondaryHint: "Do not approve purchase until CJ freight, stock, and order-create proof are established.",
      manualReviewRequired: true,
    };
  }

  if (status === "MANUAL_REVIEW_REQUIRED") {
    return {
      label: "Checked - manual review",
      technicalLabel: "PRICE_GUARD_MANUAL_REVIEW",
      hint: "Validation needed before purchase.",
      secondaryHint: "Re-check supplier price and availability before purchase.",
      manualReviewRequired: true,
    };
  }

  return {
    label: "Not checked yet",
    technicalLabel: "VALIDATION_NOT_RUN",
    hint: "Manual review required.",
    secondaryHint: "Link order to listing candidate, then run a fresh safety check.",
    manualReviewRequired: true,
  };
}

function buildSafetyCheckEventPayload(input: {
  status: OrderPurchaseSafetyStatus;
  actorId?: string;
  gate: "READ_ONLY" | "APPROVAL_GUARD";
  passed: boolean;
}): Record<string, unknown> {
  return {
    action: "PURCHASE_SAFETY_CHECK",
    gate: input.gate,
    passed: input.passed,
    actorId: input.actorId ?? null,
    checkedAt: input.status.checkedAt,
    status: input.status.status,
    label: input.status.label,
    technicalLabel: input.status.technicalLabel,
    reasons: input.status.reasons,
    candidateId: input.status.candidateId,
    listingId: input.status.listingId,
    futureExecutionHook: input.status.futureExecutionHook,
    economics_hard_pass: input.status.economics_hard_pass,
    economics_block_reason: input.status.economics_block_reason,
    economics_verified_at: input.status.economics_verified_at,
  };
}

export async function getOrderPurchaseSafetyStatusByOrderId(input: {
  orderId: string;
  actorId?: string;
  writeEvent?: boolean;
  gate?: "READ_ONLY" | "APPROVAL_GUARD";
}): Promise<OrderPurchaseSafetyStatus> {
  const detail = await getAdminOrderDetail(input.orderId);
  if (!detail) throw new Error(`Order not found: ${input.orderId}`);
  const status = await getOrderPurchaseSafetyStatus(detail);

  if (input.writeEvent) {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: buildSafetyCheckEventPayload({
        status,
        actorId: input.actorId,
        gate: input.gate ?? "READ_ONLY",
        passed: status.status === "READY_FOR_PURCHASE_REVIEW",
      }),
    });
  }

  return status;
}

export async function assertOrderPurchaseSafetyForApproval(input: {
  orderId: string;
  actorId?: string;
}): Promise<OrderPurchaseSafetyStatus> {
  const status = await getOrderPurchaseSafetyStatusByOrderId({
    orderId: input.orderId,
    actorId: input.actorId,
    writeEvent: true,
    gate: "APPROVAL_GUARD",
  });

  if (status.status !== "READY_FOR_PURCHASE_REVIEW") {
    throw new Error(
      `Approval blocked by purchase safety: ${status.label}. ${status.secondaryHint ?? status.hint}`
    );
  }
  return status;
}

async function evaluateStrictOrderItemSafety(detail: AdminOrderDetail): Promise<string[]> {
  const reasons: string[] = [];
  for (const item of detail.items) {
    const safetyReasons = evaluatePinnedSupplierSafety({
      supplierKey: item.supplierKey,
      supplierProductId: item.supplierProductId,
      linkageDeterministic: (item as unknown as { linkageDeterministic?: boolean }).linkageDeterministic === true,
      supplierLinkLocked: (item as unknown as { supplierLinkLocked?: boolean }).supplierLinkLocked === true,
      stockStatus: normalizeSupplierStockStatus((item as unknown as { supplierStockStatus?: string }).supplierStockStatus),
      stockQty: (item as unknown as { supplierStockQty?: number | null }).supplierStockQty,
      stockVerifiedAt: (item as unknown as { stockVerifiedAt?: string | null }).stockVerifiedAt,
      requiredQty: item.quantity,
    });
    reasons.push(...safetyReasons);

    const supplierKey = String(item.supplierKey ?? "").trim();
    const supplierProductId = String(item.supplierProductId ?? "").trim();
    if (!supplierKey || !supplierProductId) continue;

    const fetched = await db.execute<{ supplierKey: string; supplierProductId: string; availabilityStatus: string | null; snapshotTs: Date | null; stockQty: number | null; rawPayload: unknown }>(sql`
      SELECT
        pr.supplier_key AS "supplierKey",
        pr.supplier_product_id AS "supplierProductId",
        pr.availability_status AS "availabilityStatus",
        pr.snapshot_ts AS "snapshotTs",
        pr.raw_payload AS "rawPayload",
        COALESCE(
          NULLIF(pr.raw_payload ->> 'supplierStockQty', '')::integer,
          NULLIF(pr.raw_payload ->> 'stockCount', '')::integer,
          NULLIF(pr.raw_payload ->> 'availableQuantity', '')::integer,
          NULLIF(pr.raw_payload ->> 'inventoryCount', '')::integer
        ) AS "stockQty"
      FROM products_raw pr
      WHERE LOWER(pr.supplier_key) = LOWER(${supplierKey})
        AND pr.supplier_product_id = ${supplierProductId}
      ORDER BY pr.snapshot_ts DESC, pr.id DESC
      LIMIT 1
    `);

    const row = fetched.rows?.[0];
    if (!row) {
      reasons.push("STOCK_FETCH_FAILED");
      continue;
    }
    if (
      !hasExactPinnedSupplierIdentityMatch({
        expectedSupplierKey: supplierKey,
        expectedSupplierProductId: supplierProductId,
        fetchedSupplierKey: row.supplierKey,
        fetchedSupplierProductId: row.supplierProductId,
      })
    ) {
      reasons.push("LINKED_SUPPLIER_PRODUCT_MISMATCH");
      continue;
    }

    const liveSafetyReasons = evaluatePinnedSupplierSafety({
      supplierKey,
      supplierProductId,
      linkageDeterministic: true,
      supplierLinkLocked: true,
      stockStatus: row.availabilityStatus,
      stockQty: row.stockQty,
      stockVerifiedAt: row.snapshotTs,
      requiredQty: item.quantity,
    });
    reasons.push(...liveSafetyReasons);

    if (supplierKey.toLowerCase() === "cjdropshipping") {
      const cjProofState = readCjProofStateFromRawPayload(row.rawPayload);
      const cjProofBlockingReason = getCjProofBlockingReason(cjProofState);
      if (!isCjProofPurchaseSafe(cjProofState) || cjProofBlockingReason) {
        reasons.push(...(cjProofState ? cjProofState.blockingReasons : ["CJ_PROOF_STATE_MISSING"]));
        if (cjProofState?.orderCreate !== "PROVEN") reasons.push("CJ_ORDER_CREATE_UNPROVEN");
        if (cjProofState?.stock !== "PROVEN") reasons.push("CJ_STOCK_UNPROVEN");
        if (cjProofState?.freight !== "PROVEN") reasons.push("CJ_FREIGHT_UNPROVEN");
        reasons.push("CJ_PROOF_PURCHASE_BLOCK");
      }
    }
  }

  return uniqueStrings(reasons);
}

export async function getOrderPurchaseSafetyStatus(
  detail: AdminOrderDetail
): Promise<OrderPurchaseSafetyStatus> {
  if (!hasSupplierLinkage(detail)) {
    const presentation = mapStatusPresentation("BLOCKED_SUPPLIER_LINKAGE_REQUIRED");
    return {
      status: "BLOCKED_SUPPLIER_LINKAGE_REQUIRED",
      label: presentation.label,
      technicalLabel: presentation.technicalLabel,
      hint: presentation.hint,
      secondaryHint: presentation.secondaryHint,
      manualReviewRequired: presentation.manualReviewRequired,
      checkedAt: null,
      reasons: ["ORDER_SUPPLIER_LINKAGE_REQUIRED", "MISSING_SUPPLIER_PRODUCT_ID"],
      candidateId: null,
      listingId: null,
      futureExecutionHook: "REQUIRE_FRESH_SUPPLIER_VALIDATION",
      economics_hard_pass: false,
      economics_block_reason: "ORDER_SUPPLIER_LINKAGE_REQUIRED",
      economics_verified_at: null,
    };
  }

  const strictReasons = await evaluateStrictOrderItemSafety(detail);
  if (strictReasons.length > 0) {
    const status = statusFromReasons(strictReasons);
    const presentation = mapStatusPresentation(status);
    return {
      status,
      label: presentation.label,
      technicalLabel: presentation.technicalLabel,
      hint: presentation.hint,
      secondaryHint: presentation.secondaryHint,
      manualReviewRequired: presentation.manualReviewRequired,
      checkedAt: new Date().toISOString(),
      reasons: strictReasons,
      candidateId: null,
      listingId: null,
      futureExecutionHook: "REQUIRE_FRESH_SUPPLIER_VALIDATION",
      economics_hard_pass: false,
      economics_block_reason: strictReasons.join(","),
      economics_verified_at: new Date().toISOString(),
    };
  }

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
      economics_hard_pass: false,
      economics_block_reason: "ORDER_CANDIDATE_LINK_REQUIRED",
      economics_verified_at: null,
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
      economics_hard_pass: priceGuard.economics_hard_pass,
      economics_block_reason: priceGuard.economics_block_reason,
      economics_verified_at: priceGuard.economics_verified_at,
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
      economics_hard_pass: false,
      economics_block_reason: "ORDER_SAFETY_CHECK_FAILED",
      economics_verified_at: null,
    };
  }
}
