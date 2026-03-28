export function hasExactPinnedSupplierIdentityMatch(input: {
  expectedSupplierKey: string;
  expectedSupplierProductId: string;
  fetchedSupplierKey: string | null;
  fetchedSupplierProductId: string | null;
}): boolean {
  return (
    String(input.fetchedSupplierKey ?? "").trim().toLowerCase() === input.expectedSupplierKey.trim().toLowerCase() &&
    String(input.fetchedSupplierProductId ?? "").trim() === input.expectedSupplierProductId.trim()
  );
}
