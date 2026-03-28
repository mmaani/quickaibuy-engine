export function canRewritePinnedSupplierLinkageForListingStatus(status: string): boolean {
  return String(status).trim().toUpperCase() === "PREVIEW";
}
