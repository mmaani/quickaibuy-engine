import type { ListingPreviewOutput } from "./types";

export function validateListingPreview(preview: ListingPreviewOutput) {
  const errors: string[] = [];

  if (!preview.marketplaceKey) errors.push("marketplaceKey required");
  if (!preview.title?.trim()) errors.push("title required");
  if (preview.marketplaceKey === "ebay" && preview.title.length > 80) {
    errors.push("ebay title exceeds 80 chars");
  }
  if (!(preview.price > 0)) errors.push("price must be > 0");
  if (!(preview.quantity > 0)) errors.push("quantity must be > 0");
  if (!preview.payload || typeof preview.payload !== "object") {
    errors.push("payload required");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
