export function canRewritePinnedSupplierLinkageForListingStatus(status: string): boolean {
  return String(status).trim().toUpperCase() === "PREVIEW";
}

export function isSupplierLinkageImmutableForListingStatus(status: string): boolean {
  return !canRewritePinnedSupplierLinkageForListingStatus(status);
}
