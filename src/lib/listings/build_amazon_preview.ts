import type { ListingPreviewInput, ListingPreviewOutput } from "./types";

export function buildAmazonPreview(input: ListingPreviewInput): ListingPreviewOutput {
  return {
    marketplaceKey: "amazon",
    title: (input.marketplaceTitle || input.supplierTitle || "Deferred Amazon preview")
      .trim()
      .slice(0, 200),
    price: typeof input.marketplacePrice === "number" ? input.marketplacePrice : 0,
    quantity: 1,
    payload: {
      dryRun: true,
      deferred: true,
      marketplace: "amazon",
      note: "Amazon preview is deferred in v1 and must not block eBay workflow completion.",
      candidateId: input.candidateId,
    },
    response: {
      preview: true,
      previewVersion: "v1",
      deferred: true,
      liveApiCalled: false,
    },
  };
}
