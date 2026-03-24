import { getMediaStorageMode } from "@/lib/media/storage";
import { normalizeWarehouseCountry } from "@/lib/marketplaces/ebay/normalizeWarehouseCountry";
import { generateListingDescription } from "./generateListingDescription";
import { buildListingPreviewMedia } from "./media";
import { optimizeListingTitle } from "./optimizeListingTitle";
import type { EbayListingPreviewPayload, ListingPreviewInput, ListingPreviewOutput } from "./types";

function pickTitle(input: ListingPreviewInput): string {
  return optimizeListingTitle({
    marketplaceTitle: input.marketplaceTitle,
    supplierTitle: input.supplierTitle,
    supplierKey: input.supplierKey,
    supplierProductId: input.supplierProductId,
  });
}

function pickPrice(input: ListingPreviewInput): number {
  if (typeof input.marketplacePrice === "number" && Number.isFinite(input.marketplacePrice)) {
    return Number(input.marketplacePrice.toFixed(2));
  }
  if (typeof input.supplierPrice === "number" && Number.isFinite(input.supplierPrice)) {
    return Number((input.supplierPrice * 2).toFixed(2));
  }
  return 0;
}

export function buildEbayPreview(input: ListingPreviewInput): ListingPreviewOutput {
  const mediaStorageMode = getMediaStorageMode();
  const title = pickTitle(input);
  const price = pickPrice(input);
  const quantity = 1;
  const shipFromCountry = normalizeWarehouseCountry(input.supplierWarehouseCountry ?? input.shipFromCountry);
  const media = buildListingPreviewMedia(input);
  const images = media.images.map((image) => image.url);
  const description = generateListingDescription({
    title,
    supplierTitle: input.supplierTitle,
    supplierRawPayload: input.supplierRawPayload,
  });

  const payload: EbayListingPreviewPayload = {
    dryRun: true,
    marketplace: "ebay",
    listingType: "fixed_price",
    title,
    price,
    quantity,
    condition: "NEW",
    shipFromCountry,
    images,
    media,
    description,
    source: {
      candidateId: input.candidateId,
      supplierKey: input.supplierKey,
      supplierProductId: input.supplierProductId,
      supplierTitle: input.supplierTitle,
      supplierSourceUrl: input.supplierSourceUrl,
      supplierImageUrl: input.supplierImageUrl,
      supplierImages: input.supplierImages ?? [],
      supplierWarehouseCountry: input.supplierWarehouseCountry,
      shipFromCountry: input.shipFromCountry,
    },
    matchedMarketplace: {
      marketplaceKey: input.marketplaceKey,
      marketplaceListingId: input.marketplaceListingId,
      marketplaceTitle: input.marketplaceTitle,
      marketplacePrice: input.marketplacePrice,
    },
    economics: {
      estimatedProfit: input.estimatedProfit,
      marginPct: input.marginPct,
      roiPct: input.roiPct,
    },
    categoryId: input.categoryId ?? null,
    categoryConfidence: null,
    categoryRuleLabel: null,
  };

  return {
    marketplaceKey: "ebay",
    title,
    price,
    quantity,
    payload,
    response: {
      preview: true,
      previewVersion: "v1",
      liveApiCalled: false,
      titleLength: title.length,
      categoryId: input.categoryId ?? null,
      description,
      imagesSelected: media.audit.imageSelectedCount,
      imageOrder: media.images.map((image) => ({
        rank: image.rank,
        kind: image.kind,
        source: image.source,
        hostingMode: image.hostingMode,
        url: image.url,
      })),
      mediaStorageMode,
      videoDetected: media.audit.videoDetected,
      videoAttached: media.audit.videoAttached,
      videoSkipReason: media.audit.videoSkipReason,
      operatorNote: media.audit.operatorNote,
      imageNormalization: {
        code: "IMAGE_NORMALIZATION_PENDING",
        ok: false,
        selectedSourceCount: media.audit.imageSelectedCount,
        normalizedEpsCount: 0,
        cacheHits: 0,
        freshUploads: 0,
        failedSourceUrls: [],
        finalSlotOrder: images,
        provider: null,
        providerAttempted: null,
        providerUsed: null,
        mediaApiAttempted: false,
        mediaApiResultCode: null,
        tradingFallbackAttempted: false,
        tradingFallbackResultCode: null,
        blockingReason: "EPS normalization has not run yet.",
      },
    },
  };
}
