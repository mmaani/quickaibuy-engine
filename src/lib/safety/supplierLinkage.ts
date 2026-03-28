export type CanonicalSupplierStockStatus = "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";

export type SupplierSafetyBlockReason =
  | "MISSING_SUPPLIER_KEY"
  | "MISSING_SUPPLIER_PRODUCT_ID"
  | "NON_DETERMINISTIC_LINKAGE"
  | "SUPPLIER_LINK_NOT_LOCKED"
  | "OUT_OF_STOCK"
  | "STOCK_UNKNOWN"
  | "STOCK_STALE"
  | "STOCK_FETCH_FAILED"
  | "INSUFFICIENT_STOCK_QTY"
  | "SUPPLIER_FALLBACK_BLOCKED"
  | "SUPPLIER_SUBSTITUTION_BLOCKED"
  | "LINKED_SUPPLIER_PRODUCT_MISMATCH";

export const STOCK_FRESHNESS_THRESHOLD_MINUTES = 30;

function toCleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeSupplierStockStatus(value: unknown): CanonicalSupplierStockStatus {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "UNKNOWN";
  if (raw === "IN_STOCK") return "IN_STOCK";
  if (raw === "OUT_OF_STOCK") return "OUT_OF_STOCK";

  if (
    raw.includes("OUT") ||
    raw.includes("UNAVAILABLE") ||
    raw.includes("SOLD") ||
    raw.includes("REMOVED")
  ) {
    return "OUT_OF_STOCK";
  }
  if (raw.includes("IN_STOCK") || raw.includes("AVAILABLE") || raw.includes("INSTOCK")) {
    return "IN_STOCK";
  }

  return "UNKNOWN";
}

export function deriveCanonicalStockFromRaw(input: {
  availabilityStatus: unknown;
  rawPayload: unknown;
}): { status: CanonicalSupplierStockStatus; qty: number | null; source: string } {
  const payload =
    input.rawPayload && typeof input.rawPayload === "object" && !Array.isArray(input.rawPayload)
      ? (input.rawPayload as Record<string, unknown>)
      : null;

  const payloadStatus =
    payload?.supplierStockStatus ??
    payload?.availabilitySignal ??
    payload?.availability_status ??
    payload?.availabilityStatus ??
    payload?.availability;

  const qty =
    toFiniteNumber(payload?.supplierStockQty) ??
    toFiniteNumber(payload?.stockCount) ??
    toFiniteNumber(payload?.stock_count) ??
    toFiniteNumber(payload?.inventoryCount) ??
    toFiniteNumber(payload?.availableQuantity) ??
    toFiniteNumber(payload?.quantityAvailable);

  const normalized = normalizeSupplierStockStatus(payloadStatus ?? input.availabilityStatus);
  if (normalized !== "UNKNOWN") {
    return {
      status: normalized,
      qty,
      source: payloadStatus != null ? "supplier_payload" : "availability_status",
    };
  }

  if (qty != null) {
    return {
      status: qty > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
      qty,
      source: "supplier_payload_qty",
    };
  }

  return {
    status: "UNKNOWN",
    qty: null,
    source: "supplier_payload_unavailable",
  };
}

export function evaluatePinnedSupplierSafety(input: {
  supplierKey: string | null;
  supplierProductId: string | null;
  linkageDeterministic: boolean;
  supplierLinkLocked: boolean;
  stockStatus: unknown;
  stockQty?: unknown;
  stockVerifiedAt?: unknown;
  now?: Date;
  requiredQty?: number;
}): SupplierSafetyBlockReason[] {
  const reasons: SupplierSafetyBlockReason[] = [];
  const now = input.now ?? new Date();

  if (!toCleanString(input.supplierKey)) reasons.push("MISSING_SUPPLIER_KEY");
  if (!toCleanString(input.supplierProductId)) reasons.push("MISSING_SUPPLIER_PRODUCT_ID");
  if (!input.linkageDeterministic) reasons.push("NON_DETERMINISTIC_LINKAGE");
  if (!input.supplierLinkLocked) reasons.push("SUPPLIER_LINK_NOT_LOCKED");

  const normalizedStatus = normalizeSupplierStockStatus(input.stockStatus);
  if (normalizedStatus === "OUT_OF_STOCK") reasons.push("OUT_OF_STOCK");
  if (normalizedStatus === "UNKNOWN") reasons.push("STOCK_UNKNOWN");

  const verifiedAt = toDate(input.stockVerifiedAt);
  if (!verifiedAt) {
    reasons.push("STOCK_STALE");
  } else {
    const ageMinutes = (now.getTime() - verifiedAt.getTime()) / (1000 * 60);
    if (!Number.isFinite(ageMinutes) || ageMinutes > STOCK_FRESHNESS_THRESHOLD_MINUTES) {
      reasons.push("STOCK_STALE");
    }
  }

  const qty = toFiniteNumber(input.stockQty);
  const requiredQty = Math.max(1, Math.trunc(input.requiredQty ?? 1));
  if (qty != null && qty < requiredQty) {
    reasons.push("INSUFFICIENT_STOCK_QTY");
  }

  return Array.from(new Set(reasons));
}
