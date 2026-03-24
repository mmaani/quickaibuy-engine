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
  if (preview.marketplaceKey === "ebay" && preview.title.length < 45) {
    errors.push("ebay title must be at least 45 chars");
  }
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
    if (images.length < 5) {
      errors.push("ebay preview requires at least 5 images");
    }
    if (images.length > 24) {
      errors.push("ebay image count exceeds 24");
    }
    const description = String(payload?.description ?? "").trim();
    if (!description) {
      errors.push("ebay description required");
    }
    const media =
      payload?.media && typeof payload.media === "object" && !Array.isArray(payload.media)
        ? (payload.media as Record<string, unknown>)
        : null;
    const mediaAudit =
      media?.audit && typeof media.audit === "object" && !Array.isArray(media.audit)
        ? (media.audit as Record<string, unknown>)
        : null;
    const video =
      media?.video && typeof media.video === "object" && !Array.isArray(media.video)
        ? (media.video as Record<string, unknown>)
        : null;
    if (video?.url != null && !isHttpUrl(video.url)) {
      errors.push("ebay media video must be URL reference only");
    }
    const selectedImageCount = Number(mediaAudit?.imageSelectedCount ?? images.length);
    const skippedImageCount = Number(mediaAudit?.imageSkippedCount ?? 0);
    if (Number.isFinite(selectedImageCount) && selectedImageCount < 5) {
      errors.push("ebay media audit selected fewer than 5 images");
    }
    if (
      Number.isFinite(selectedImageCount) &&
      Number.isFinite(skippedImageCount) &&
      skippedImageCount > selectedImageCount &&
      selectedImageCount < 8
    ) {
      errors.push("ebay media quality gate failed due to low-quality media dominance");
    }
    const categoryId = String(payload?.categoryId ?? "").trim();
    if (!categoryId) {
      errors.push("ebay categoryId required");
    } else if (!/^\d+$/.test(categoryId)) {
      errors.push("ebay categoryId must be numeric");
    }
    const categoryConfidence = Number(payload?.categoryConfidence ?? preview.response?.categoryConfidence ?? NaN);
    if (!Number.isFinite(categoryConfidence) || categoryConfidence <= 0) {
      errors.push("ebay category confidence required");
    }
    const source =
      payload?.source && typeof payload.source === "object" && !Array.isArray(payload.source)
        ? (payload.source as Record<string, unknown>)
        : null;
    const matchedMarketplace =
      payload?.matchedMarketplace &&
      typeof payload.matchedMarketplace === "object" &&
      !Array.isArray(payload.matchedMarketplace)
        ? (payload.matchedMarketplace as Record<string, unknown>)
        : null;
    if (!String(source?.candidateId ?? "").trim()) errors.push("ebay source candidateId required");
    if (!String(source?.supplierKey ?? "").trim()) errors.push("ebay source supplierKey required");
    if (!String(source?.supplierProductId ?? "").trim()) errors.push("ebay source supplierProductId required");
    if (!String(matchedMarketplace?.marketplaceListingId ?? "").trim()) {
      errors.push("ebay matched marketplace listing id required");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
