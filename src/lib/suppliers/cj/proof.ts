import type { CjSettingsSummary } from "./types";

export type CjProofStatus = "PROVEN" | "PARTIALLY_PROVEN" | "UNPROVEN";

export type CjProofStateCode =
  | "CJ_AUTH_PROVEN"
  | "CJ_PRODUCT_PROVEN"
  | "CJ_VARIANT_PROVEN"
  | "CJ_STOCK_PROVEN"
  | "CJ_FREIGHT_PROVEN"
  | "CJ_ORDER_CREATE_PROVEN"
  | "CJ_ORDER_DETAIL_PROVEN"
  | "CJ_ORDER_CREATE_UNPROVEN"
  | "CJ_ORDER_DETAIL_UNPROVEN"
  | "CJ_TRACKING_UNPROVEN";

export type CjProofStateSnapshot = {
  supplierKey: "cjdropshipping";
  evaluatedAt: string;
  auth: CjProofStatus;
  product: CjProofStatus;
  variant: CjProofStatus;
  stock: CjProofStatus;
  freight: CjProofStatus;
  orderCreate: CjProofStatus;
  orderDetail: CjProofStatus;
  tracking: CjProofStatus;
  overall: CjProofStatus;
  codes: CjProofStateCode[];
  blockingReasons: string[];
  proofSource: "live_validation_2026_04_04";
  runtime: {
    operationalState: CjSettingsSummary["operationalState"] | "unknown";
    sandbox: boolean | null;
    qpsLimit: number | null;
    quotaLimit: number | null;
    quotaRemaining: number | null;
  };
};

export type CjFulfillmentProofStatus = "SAFE" | "LIMITED" | "BLOCKED";

type BuildCjProofStateInput = {
  evaluatedAt?: string;
  settings?: CjSettingsSummary | null;
  hasProductEvidence?: boolean;
  hasVariantEvidence?: boolean;
  hasStockEvidence?: boolean;
  hasFreightEvidence?: boolean;
};

const LIVE_PROOF_BASELINE = {
  auth: "PROVEN" as const,
  product: "PROVEN" as const,
  variant: "PROVEN" as const,
  stock: "PROVEN" as const,
  freight: "PROVEN" as const,
  orderCreate: "PROVEN" as const,
  orderDetail: "PROVEN" as const,
  tracking: "UNPROVEN" as const,
};

function weakenProof(status: CjProofStatus, hasEvidence: boolean | undefined): CjProofStatus {
  if (hasEvidence == null) return status;
  if (hasEvidence) return status;
  return "UNPROVEN";
}

function pickOverallProof(snapshot: Omit<CjProofStateSnapshot, "overall">): CjProofStatus {
  const statuses: CjProofStatus[] = [
    snapshot.auth,
    snapshot.product,
    snapshot.variant,
    snapshot.stock,
    snapshot.freight,
    snapshot.orderCreate,
    snapshot.orderDetail,
    snapshot.tracking,
  ];
  if (statuses.every((status) => status === "PROVEN")) return "PROVEN";
  if (statuses.some((status) => status === "PROVEN")) return "PARTIALLY_PROVEN";
  return "UNPROVEN";
}

function buildCodes(snapshot: Omit<CjProofStateSnapshot, "codes" | "blockingReasons" | "overall">): CjProofStateCode[] {
  const codes: CjProofStateCode[] = [];
  if (snapshot.auth === "PROVEN") codes.push("CJ_AUTH_PROVEN");
  if (snapshot.product === "PROVEN") codes.push("CJ_PRODUCT_PROVEN");
  if (snapshot.variant === "PROVEN") codes.push("CJ_VARIANT_PROVEN");
  if (snapshot.stock === "PROVEN") codes.push("CJ_STOCK_PROVEN");
  if (snapshot.freight === "PROVEN") codes.push("CJ_FREIGHT_PROVEN");
  if (snapshot.orderCreate === "PROVEN") codes.push("CJ_ORDER_CREATE_PROVEN");
  if (snapshot.orderDetail === "PROVEN") codes.push("CJ_ORDER_DETAIL_PROVEN");
  if (snapshot.orderCreate !== "PROVEN") codes.push("CJ_ORDER_CREATE_UNPROVEN");
  if (snapshot.orderDetail !== "PROVEN") codes.push("CJ_ORDER_DETAIL_UNPROVEN");
  if (snapshot.tracking !== "PROVEN") codes.push("CJ_TRACKING_UNPROVEN");
  return codes;
}

function buildBlockingReasons(snapshot: Omit<CjProofStateSnapshot, "codes" | "blockingReasons" | "overall">): string[] {
  const reasons: string[] = [];
  if (snapshot.auth !== "PROVEN") reasons.push("CJ_AUTH_NOT_PROVEN");
  if (snapshot.stock !== "PROVEN") reasons.push("CJ_STOCK_NOT_PROVEN");
  if (snapshot.freight !== "PROVEN") reasons.push("CJ_FREIGHT_NOT_PROVEN");
  if (snapshot.orderCreate !== "PROVEN") reasons.push("CJ_ORDER_CREATE_NOT_PROVEN");
  return reasons;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isCjSupplierKey(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "cj" || normalized === "cj dropshipping" || normalized === "cjdropshipping";
}

export function buildCjProofStateSnapshot(input?: BuildCjProofStateInput): CjProofStateSnapshot {
  const base = {
    supplierKey: "cjdropshipping" as const,
    evaluatedAt: input?.evaluatedAt ?? new Date().toISOString(),
    auth: LIVE_PROOF_BASELINE.auth,
    product: weakenProof(LIVE_PROOF_BASELINE.product, input?.hasProductEvidence),
    variant: weakenProof(LIVE_PROOF_BASELINE.variant, input?.hasVariantEvidence),
    stock: weakenProof(LIVE_PROOF_BASELINE.stock, input?.hasStockEvidence),
    freight: weakenProof(LIVE_PROOF_BASELINE.freight, input?.hasFreightEvidence),
    orderCreate: LIVE_PROOF_BASELINE.orderCreate,
    orderDetail: LIVE_PROOF_BASELINE.orderDetail,
    tracking: LIVE_PROOF_BASELINE.tracking,
    proofSource: "live_validation_2026_04_04" as const,
    runtime: {
      operationalState: input?.settings?.operationalState ?? "unknown",
      sandbox: input?.settings?.sandbox ?? null,
      qpsLimit: input?.settings?.qpsLimit ?? null,
      quotaLimit: input?.settings?.quotaLimit ?? null,
      quotaRemaining: input?.settings?.quotaRemaining ?? null,
    },
  };

  const codes = buildCodes(base);
  const blockingReasons = buildBlockingReasons(base);
  return {
    ...base,
    codes,
    blockingReasons,
    overall: pickOverallProof({ ...base, codes, blockingReasons }),
  };
}

export function readCjProofStateFromRawPayload(rawPayload: unknown): CjProofStateSnapshot | null {
  const raw = asObject(rawPayload);
  const proof = asObject(raw?.cjProofState);
  if (!proof) return null;
  const runtime = asObject(proof.runtime);
  return {
    supplierKey: "cjdropshipping",
    evaluatedAt: typeof proof.evaluatedAt === "string" ? proof.evaluatedAt : new Date().toISOString(),
    auth: proof.auth === "UNPROVEN" || proof.auth === "PARTIALLY_PROVEN" ? proof.auth : "PROVEN",
    product: proof.product === "UNPROVEN" || proof.product === "PARTIALLY_PROVEN" ? proof.product : "PROVEN",
    variant: proof.variant === "UNPROVEN" || proof.variant === "PARTIALLY_PROVEN" ? proof.variant : "PROVEN",
    stock: proof.stock === "UNPROVEN" || proof.stock === "PARTIALLY_PROVEN" ? proof.stock : "PROVEN",
    freight: proof.freight === "UNPROVEN" || proof.freight === "PARTIALLY_PROVEN" ? proof.freight : "PROVEN",
    orderCreate:
      proof.orderCreate === "PROVEN" || proof.orderCreate === "PARTIALLY_PROVEN" ? proof.orderCreate : "UNPROVEN",
    orderDetail:
      proof.orderDetail === "PROVEN" || proof.orderDetail === "PARTIALLY_PROVEN" ? proof.orderDetail : "UNPROVEN",
    tracking: proof.tracking === "PROVEN" || proof.tracking === "PARTIALLY_PROVEN" ? proof.tracking : "UNPROVEN",
    overall: proof.overall === "PROVEN" || proof.overall === "UNPROVEN" ? proof.overall : "PARTIALLY_PROVEN",
    codes: Array.isArray(proof.codes) ? (proof.codes.filter((value) => typeof value === "string") as CjProofStateCode[]) : [],
    blockingReasons: Array.isArray(proof.blockingReasons)
      ? proof.blockingReasons.filter((value) => typeof value === "string")
      : [],
    proofSource: "live_validation_2026_04_04",
    runtime: {
      operationalState:
        runtime?.operationalState === "verified-like" || runtime?.operationalState === "unverified-like"
          ? runtime.operationalState
          : "unknown",
      sandbox: typeof runtime?.sandbox === "boolean" ? runtime.sandbox : null,
      qpsLimit: typeof runtime?.qpsLimit === "number" ? runtime.qpsLimit : null,
      quotaLimit: typeof runtime?.quotaLimit === "number" ? runtime.quotaLimit : null,
      quotaRemaining: typeof runtime?.quotaRemaining === "number" ? runtime.quotaRemaining : null,
    },
  };
}

export function getCjProofRiskFlags(snapshot: CjProofStateSnapshot | null): string[] {
  if (!snapshot) return ["CJ_PROOF_STATE_MISSING"];
  const flags: string[] = [];
  if (snapshot.auth !== "PROVEN") flags.push("CJ_AUTH_UNPROVEN");
  if (snapshot.freight !== "PROVEN") flags.push("CJ_FREIGHT_UNPROVEN");
  if (snapshot.stock !== "PROVEN") flags.push("CJ_STOCK_UNPROVEN");
  if (snapshot.orderCreate !== "PROVEN") flags.push("CJ_ORDER_CREATE_UNPROVEN");
  if (snapshot.orderDetail !== "PROVEN") flags.push("CJ_ORDER_DETAIL_UNPROVEN");
  if (snapshot.tracking !== "PROVEN") flags.push("CJ_TRACKING_UNPROVEN");
  return flags;
}

export function getCjFulfillmentProofStatus(snapshot: CjProofStateSnapshot | null): CjFulfillmentProofStatus {
  if (!snapshot) return "BLOCKED";
  if (snapshot.auth !== "PROVEN" || snapshot.freight !== "PROVEN" || snapshot.stock !== "PROVEN") return "BLOCKED";
  if (snapshot.orderCreate !== "PROVEN" || snapshot.orderDetail !== "PROVEN" || snapshot.tracking !== "PROVEN") {
    return "LIMITED";
  }
  return "SAFE";
}

export function getCjProofRankingPenalty(snapshot: CjProofStateSnapshot | null): number {
  if (!snapshot) return 30;
  if (snapshot.auth !== "PROVEN" || snapshot.freight !== "PROVEN" || snapshot.stock !== "PROVEN") return 24;
  if (snapshot.tracking !== "PROVEN") return 3;
  return 0;
}

export function getCjProofConfidenceCap(snapshot: CjProofStateSnapshot | null): number {
  if (!snapshot) return 0.62;
  if (snapshot.auth !== "PROVEN" || snapshot.freight !== "PROVEN" || snapshot.stock !== "PROVEN") return 0.58;
  if (snapshot.tracking !== "PROVEN") return 0.9;
  return 1;
}

export function getCjProofExplanation(snapshot: CjProofStateSnapshot | null): string {
  if (!snapshot) return "CJ proof-state missing from supplier payload.";
  const fulfillmentStatus = getCjFulfillmentProofStatus(snapshot);
  if (fulfillmentStatus === "SAFE") return "CJ auth, freight, stock, order-create, order-detail, and tracking are proven.";
  if (snapshot.auth !== "PROVEN") return "CJ auth proof is missing, so runtime trust must stay blocked.";
  if (snapshot.freight !== "PROVEN") return "CJ freight is not proven, so shipping truth must stay blocked.";
  if (snapshot.stock !== "PROVEN") return "CJ stock is not proven, so fulfillment truth must stay blocked.";
  if (snapshot.orderCreate !== "PROVEN") return "CJ order-create is not proven, so purchase safety must stay blocked.";
  if (snapshot.orderDetail !== "PROVEN") return "CJ order-detail is not proven, so downstream lifecycle validation remains limited.";
  return "CJ order-create and order-detail are proven, but tracking remains unproven, so lifecycle visibility stays partial.";
}

export function getCjProofBlockingReason(snapshot: CjProofStateSnapshot | null): string | null {
  if (!snapshot) return "CJ proof-state missing from supplier payload";
  if (snapshot.auth !== "PROVEN") return "CJ auth proof is not established for this supplier snapshot";
  if (snapshot.freight !== "PROVEN") return "CJ freight proof is not established for this supplier snapshot";
  if (snapshot.stock !== "PROVEN") return "CJ stock proof is not established for this supplier snapshot";
  if (snapshot.orderCreate !== "PROVEN") return "CJ order-create loop is not proven yet for production purchase safety";
  return null;
}

export function isCjProofPurchaseSafe(snapshot: CjProofStateSnapshot | null): boolean {
  return Boolean(
    snapshot &&
      snapshot.auth === "PROVEN" &&
      snapshot.stock === "PROVEN" &&
      snapshot.freight === "PROVEN" &&
      snapshot.orderCreate === "PROVEN"
  );
}

export function getCjProofStateSummary(settings?: CjSettingsSummary | null): CjProofStateSnapshot {
  return buildCjProofStateSnapshot({
    settings: settings ?? null,
    hasProductEvidence: true,
    hasVariantEvidence: true,
    hasStockEvidence: true,
    hasFreightEvidence: true,
  });
}
