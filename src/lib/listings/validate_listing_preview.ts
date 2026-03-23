import type { ListingPreviewOutput } from "./types";

function isHttpUrl(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

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
    const images = Array.isArray(payload?.images) ? payload.images : [];
    if (images.some((image) => !isHttpUrl(image))) {
      errors.push("ebay images must be URL references only");
    }
    if (images.length > 24) {
      errors.push("ebay image count exceeds 24");
    }
    const media =
      payload?.media && typeof payload.media === "object" && !Array.isArray(payload.media)
        ? (payload.media as Record<string, unknown>)
        : null;
    const video =
      media?.video && typeof media.video === "object" && !Array.isArray(media.video)
        ? (media.video as Record<string, unknown>)
        : null;
    if (video?.url != null && !isHttpUrl(video.url)) {
      errors.push("ebay media video must be URL reference only");
    }
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
