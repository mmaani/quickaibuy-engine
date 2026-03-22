import { normalizeWarehouseCountry } from "@/lib/marketplaces/ebay/normalizeWarehouseCountry";
import { generateListingDescription } from "./generateListingDescription";
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

function pickImages(input: ListingPreviewInput): string[] {
  if (typeof input.marketplaceImageUrl === "string" && input.marketplaceImageUrl.trim().length > 0) {
    return [input.marketplaceImageUrl];
  }

  if (typeof input.supplierImageUrl === "string" && input.supplierImageUrl.trim().length > 0) {
    return [input.supplierImageUrl];
  }

  return [];
}

export function buildEbayPreview(input: ListingPreviewInput): ListingPreviewOutput {
  const title = pickTitle(input);
  const price = pickPrice(input);
  const quantity = 1;
  const shipFromCountry = normalizeWarehouseCountry(input.supplierWarehouseCountry ?? input.shipFromCountry);
  const images = pickImages(input);
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
    description,
    source: {
      candidateId: input.candidateId,
      supplierKey: input.supplierKey,
      supplierProductId: input.supplierProductId,
      supplierTitle: input.supplierTitle,
      supplierSourceUrl: input.supplierSourceUrl,
      supplierImageUrl: input.supplierImageUrl,
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
    },
  };
}
