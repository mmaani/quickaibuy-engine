import { isCjProofPurchaseSafe, isCjSupplierKey, readCjProofStateFromRawPayload } from "@/lib/suppliers/cj";

export function normalizeSupplierKeyForSelection(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized === "cj dropshipping" ? "cjdropshipping" : normalized;
}

export function evaluateSupplierSelectionAgainstPinnedLinkage(input: {
  orderItemLinkages: Array<{
    supplierKey: string | null;
    linkageDeterministic: boolean;
    supplierLinkLocked: boolean;
  }>;
  requestedSupplierKey: string;
  supplierRawPayloads?: unknown[];
}): string | null {
  if (!input.orderItemLinkages.length) return "SUPPLIER_FALLBACK_BLOCKED";
  const pinnedSupplierKeys = Array.from(
    new Set(input.orderItemLinkages.map((row) => String(row.supplierKey ?? "").trim().toLowerCase()).filter(Boolean))
  );
  if (pinnedSupplierKeys.length !== 1) return "SUPPLIER_SUBSTITUTION_BLOCKED";
  if (pinnedSupplierKeys[0] !== normalizeSupplierKeyForSelection(input.requestedSupplierKey)) return "SUPPLIER_FALLBACK_BLOCKED";
  if (input.orderItemLinkages.some((row) => !row.linkageDeterministic || !row.supplierLinkLocked)) {
    return "SUPPLIER_LINK_NOT_LOCKED";
  }
  if (isCjSupplierKey(input.requestedSupplierKey)) {
    const proofStates = (input.supplierRawPayloads ?? []).map((rawPayload) => readCjProofStateFromRawPayload(rawPayload));
    if (!proofStates.length || proofStates.some((proofState) => !isCjProofPurchaseSafe(proofState))) {
      return "SUPPLIER_PROOF_REQUIRED";
    }
  }
  return null;
}
