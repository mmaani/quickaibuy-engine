import type { ListingPreviewOutput } from "./types";

export function validateListingPreview(preview: ListingPreviewOutput) {
  const errors: string[] = [];
  const payload =
    preview.payload && typeof preview.payload === "object"
      ? (preview.payload as Record<string, unknown>)
      : null;

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
  if (preview.marketplaceKey === "ebay" && payload?.shipFromCountry != null) {
    const shipFromCountry = String(payload.shipFromCountry ?? "").trim();
    if (shipFromCountry && !/^[A-Z]{2}$/.test(shipFromCountry)) {
      errors.push("ebay shipFromCountry must be ISO-3166-1 alpha-2");
    }
  }
  if (preview.marketplaceKey === "ebay") {
    const categoryId = String(payload?.categoryId ?? "").trim();
    if (!categoryId) {
      errors.push("ebay categoryId required");
    } else if (!/^\d+$/.test(categoryId)) {
      errors.push("ebay categoryId must be numeric");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
