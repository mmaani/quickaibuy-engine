import { generateListingPack, isAiListingEngineEnabled } from "@/lib/ai/generateListingPack";
import { getMediaStorageMode } from "@/lib/media/storage";
import { normalizeWarehouseCountry } from "@/lib/marketplaces/ebay/normalizeWarehouseCountry";
import { generateListingDescription } from "./generateListingDescription";
import { buildListingPreviewMedia } from "./media";
import { optimizeListingTitle } from "./optimizeListingTitle";
import type { EbayListingPreviewPayload, ListingPreviewInput, ListingPreviewOutput } from "./types";

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

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

function extractSupplierFeatures(rawPayload: unknown): string[] {
  const payload = objectOrNull(rawPayload);
  const values = Array.isArray(payload?.features)
    ? payload.features
    : Array.isArray(payload?.featureBullets)
      ? payload.featureBullets
      : [];

  return values
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 10);
}

function extractSupplierVariants(rawPayload: unknown): Array<Record<string, unknown>> {
  const payload = objectOrNull(rawPayload);
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  return variants.filter((entry): entry is Record<string, unknown> => Boolean(objectOrNull(entry))).slice(0, 20);
}

export async function buildEbayPreview(input: ListingPreviewInput): Promise<ListingPreviewOutput> {
  const mediaStorageMode = getMediaStorageMode();
  let title = pickTitle(input);
  const price = pickPrice(input);
  const quantity = 1;
  const shipFromCountry = normalizeWarehouseCountry(input.supplierWarehouseCountry ?? input.shipFromCountry);
  const media = buildListingPreviewMedia(input);
  const images = media.images.map((image) => image.url);
  let description = generateListingDescription({
    title,
    supplierTitle: input.supplierTitle,
    supplierRawPayload: input.supplierRawPayload,
  });

  let aiMetadata: Record<string, unknown> = {
    enabled: isAiListingEngineEnabled(),
    listingPackGenerated: false,
    schemaPassed: false,
    manualReviewRequired: false,
    reason: null,
    trustFlags: [],
  };

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

  if (isAiListingEngineEnabled()) {
    const listingPack = await generateListingPack({
      supplierTitle: input.supplierTitle,
      supplierRawPayload: input.supplierRawPayload,
      supplierFeatures: extractSupplierFeatures(input.supplierRawPayload),
      supplierMediaMetadata: {
        imageCount: images.length,
        hasVideo: media.audit.videoDetected,
        selectedImageKinds: media.audit.selectedImageKinds ?? [],
      },
      supplierVariants: extractSupplierVariants(input.supplierRawPayload),
      matchedMarketplaceEvidence: {
        marketplaceTitle: input.marketplaceTitle,
        marketplacePrice: input.marketplacePrice,
        marketplaceListingId: input.marketplaceListingId,
      },
      pricingEconomicsSummary: {
        estimatedProfit: input.estimatedProfit,
        marginPct: input.marginPct,
        roiPct: input.roiPct,
        supplierPrice: input.supplierPrice,
      },
      sellerAccountTrustProfile: {
        feedbackScore:
          Number(process.env.EBAY_SELLER_FEEDBACK_SCORE ?? process.env.SELLER_FEEDBACK_SCORE ?? "0") || 0,
        accountTier: String(process.env.EBAY_SELLER_ACCOUNT_TIER ?? "standard"),
      },
      heuristicCategory: {
        categoryId: input.categoryId ?? null,
        categoryName: null,
        confidence: null,
      },
    });

    if (listingPack.ok) {
      title = listingPack.pack.optimized_title;
      description = `${listingPack.pack.description}\n\nHighlights\n${listingPack.pack.bullet_points
        .map((bullet) => `- ${bullet}`)
        .join("\n")}`.trim();
      payload.title = title;
      payload.description = description;
      payload.categoryId = listingPack.pack.category_id || payload.categoryId;
      payload.itemSpecifics = listingPack.pack.item_specifics;
      payload.pricingHint = listingPack.pack.pricing_hint;
      payload.trustFlags = listingPack.pack.trust_flags;
      aiMetadata = {
        enabled: true,
        listingPackGenerated: true,
        schemaPassed: true,
        manualReviewRequired: Boolean(listingPack.pack.review_required),
        reason: listingPack.pack.review_required ? "AI_REVIEW_REQUIRED" : null,
        trustFlags: listingPack.pack.trust_flags,
        confidence: listingPack.pack.confidence,
      };
    } else {
      aiMetadata = {
        enabled: true,
        listingPackGenerated: false,
        schemaPassed: false,
        manualReviewRequired: true,
        reason: listingPack.reason,
        trustFlags: [],
        diagnostics: listingPack.diagnostics,
      };
    }
  }

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
      categoryId: payload.categoryId ?? null,
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
      aiListing: aiMetadata,
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
