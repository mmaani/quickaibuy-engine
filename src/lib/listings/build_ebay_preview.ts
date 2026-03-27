import { generateListingPack, isAiListingEngineEnabled } from "@/lib/ai/generateListingPack";
import { LISTING_PACK_LOW_CONFIDENCE_THRESHOLD } from "@/lib/ai/schemas";
import { verifyListingPack } from "@/lib/ai/verifyListingPack";
import { getMediaStorageMode } from "@/lib/media/storage";
import { normalizeWarehouseCountry } from "@/lib/marketplaces/ebay/normalizeWarehouseCountry";
import { generateListingDescription } from "./generateListingDescription";
import { buildListingPreviewMedia } from "./media";
import { optimizeListingTitle, sanitizeTitleForEbay } from "./optimizeListingTitle";
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

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function extractShippingEstimateBounds(rawPayload: unknown): {
  shippingDaysMin: number | null;
  shippingDaysMax: number | null;
} {
  const payload = objectOrNull(rawPayload);
  const directMin =
    toPositiveInt(payload?.deliveryEstimateMinDays) ??
    toPositiveInt(payload?.delivery_estimate_min_days) ??
    toPositiveInt(payload?.shippingTimeMinDays) ??
    toPositiveInt(payload?.shipping_time_min_days);
  const directMax =
    toPositiveInt(payload?.deliveryEstimateMaxDays) ??
    toPositiveInt(payload?.delivery_estimate_max_days) ??
    toPositiveInt(payload?.shippingTimeMaxDays) ??
    toPositiveInt(payload?.shipping_time_max_days);

  if (directMin && directMax) {
    return {
      shippingDaysMin: directMin,
      shippingDaysMax: directMax,
    };
  }

  const estimates = Array.isArray(payload?.shippingEstimates)
    ? payload.shippingEstimates
    : Array.isArray(payload?.shipping_estimates)
      ? payload.shipping_estimates
      : [];
  const firstEstimate = estimates.find(
    (entry) =>
      Boolean(objectOrNull(entry)) &&
      (toPositiveInt((entry as Record<string, unknown>).etaMinDays) ||
        toPositiveInt((entry as Record<string, unknown>).etaMaxDays) ||
        toPositiveInt((entry as Record<string, unknown>).eta_min_days) ||
        toPositiveInt((entry as Record<string, unknown>).eta_max_days))
  ) as Record<string, unknown> | undefined;

  return {
    shippingDaysMin:
      toPositiveInt(firstEstimate?.etaMinDays) ?? toPositiveInt(firstEstimate?.eta_min_days),
    shippingDaysMax:
      toPositiveInt(firstEstimate?.etaMaxDays) ??
      toPositiveInt(firstEstimate?.eta_max_days) ??
      toPositiveInt(firstEstimate?.etaMinDays) ??
      toPositiveInt(firstEstimate?.eta_min_days),
  };
}

function extractShipFromMetadata(rawPayload: unknown): {
  shipFromLocation: string | null;
  shipFromConfidence: number | null;
  shippingOriginEvidenceSource: string | null;
  shippingSignal: string | null;
  shippingConfidence: number | null;
  shippingStability: string | null;
} {
  const payload = objectOrNull(rawPayload);
  const shipFromLocation =
    String(payload?.shipFromLocation ?? payload?.ship_from_location ?? "").trim() || null;
  const shipFromConfidenceRaw = Number(payload?.shipFromConfidence);
  const shippingConfidenceRaw = Number(payload?.shippingConfidence);
  return {
    shipFromLocation,
    shipFromConfidence: Number.isFinite(shipFromConfidenceRaw) ? shipFromConfidenceRaw : null,
    shippingOriginEvidenceSource:
      String(payload?.shippingOriginEvidenceSource ?? "").trim() || null,
    shippingSignal: String(payload?.shippingSignal ?? "").trim() || null,
    shippingConfidence: Number.isFinite(shippingConfidenceRaw) ? shippingConfidenceRaw : null,
    shippingStability: String(payload?.shippingStability ?? "").trim() || null,
  };
}

export async function buildEbayPreview(input: ListingPreviewInput): Promise<ListingPreviewOutput> {
  const mediaStorageMode = getMediaStorageMode();
  let title = pickTitle(input);
  const price = pickPrice(input);
  const quantity = 1;
  const shipFromCountry = normalizeWarehouseCountry(input.supplierWarehouseCountry ?? input.shipFromCountry);
  const shippingEstimate = extractShippingEstimateBounds(input.supplierRawPayload);
  const shipFromMetadata = extractShipFromMetadata(input.supplierRawPayload);
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
    shipFromLocation: input.shipFromLocation ?? shipFromMetadata.shipFromLocation,
    shipFromConfidence: shipFromMetadata.shipFromConfidence,
    shippingOriginEvidenceSource: shipFromMetadata.shippingOriginEvidenceSource,
    shippingSignal: shipFromMetadata.shippingSignal,
    shippingConfidence: shipFromMetadata.shippingConfidence,
    shippingStability: shipFromMetadata.shippingStability,
    handlingDaysMin: shipFromCountry ? 2 : null,
    handlingDaysMax: shipFromCountry ? 3 : null,
    shippingDaysMin: shippingEstimate.shippingDaysMin,
    shippingDaysMax: shippingEstimate.shippingDaysMax,
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
      shipFromLocation: input.shipFromLocation ?? shipFromMetadata.shipFromLocation,
      shipFromConfidence: shipFromMetadata.shipFromConfidence,
      shippingOriginEvidenceSource: shipFromMetadata.shippingOriginEvidenceSource,
      shippingSignal: shipFromMetadata.shippingSignal,
      shippingConfidence: shipFromMetadata.shippingConfidence,
      shippingStability: shipFromMetadata.shippingStability,
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
    const supplierFeatures = extractSupplierFeatures(input.supplierRawPayload);
    const supplierVariants = extractSupplierVariants(input.supplierRawPayload);
    const listingPack = await generateListingPack({
      supplierTitle: input.supplierTitle,
      supplierRawPayload: input.supplierRawPayload,
      supplierFeatures,
      supplierMediaMetadata: {
        imageCount: images.length,
        hasVideo: media.audit.videoDetected,
        selectedImageKinds: media.audit.selectedImageKinds ?? [],
      },
      supplierVariants,
      matchedMarketplaceEvidence: {
        marketplaceTitle: input.marketplaceTitle,
        marketplacePrice: input.marketplacePrice,
        marketplaceListingId: input.marketplaceListingId,
        marketplaceRawPayload: input.marketplaceRawPayload ?? null,
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
        categoryName: input.categoryName ?? null,
        confidence: input.categoryConfidence ?? null,
      },
    });

    if (listingPack.ok) {
      const lowConfidence = Boolean(
        listingPack.diagnostics &&
          typeof listingPack.diagnostics === "object" &&
          (listingPack.diagnostics as Record<string, unknown>).lowConfidence === true
      );
      const verification = await verifyListingPack({
        generatedPack: listingPack.pack,
        supplierTitle: input.supplierTitle,
        supplierRawPayload: input.supplierRawPayload,
        supplierFeatures,
        supplierMediaMetadata: {
          imageCount: images.length,
          hasVideo: media.audit.videoDetected,
          selectedImageKinds: media.audit.selectedImageKinds ?? [],
          selectedImageUrls: media.audit.selectedImageUrls,
        },
        matchedMarketplaceEvidence: {
          marketplaceTitle: input.marketplaceTitle,
          marketplacePrice: input.marketplacePrice,
          marketplaceListingId: input.marketplaceListingId,
          marketplaceRawPayload: input.marketplaceRawPayload ?? null,
        },
        pricingEconomicsSummary: {
          estimatedProfit: input.estimatedProfit,
          marginPct: input.marginPct,
          roiPct: input.roiPct,
          supplierPrice: input.supplierPrice,
        },
        heuristicCategory: {
          categoryId: input.categoryId ?? null,
          categoryName: input.categoryName ?? null,
          confidence: input.categoryConfidence ?? null,
          ruleLabel: input.categoryRuleLabel ?? null,
        },
      });
      const verifiedPack = verification.ok
        ? verification.pack
        : {
            verified_title: listingPack.pack.optimized_title,
            verified_category_id: listingPack.pack.category_id,
            verified_category_name: listingPack.pack.category_name,
            verified_bullet_points: listingPack.pack.bullet_points,
            verified_description: listingPack.pack.description,
            verified_item_specifics: listingPack.pack.item_specifics,
            removed_claims: [],
            corrected_fields: [],
            risk_flags: ["LISTING_VERIFICATION_FAILED"],
            verification_confidence: 0,
            review_required: true,
          };
      const lowVerificationConfidence =
        verifiedPack.verification_confidence < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD || verifiedPack.risk_flags.includes("VERIFICATION_CONFIDENCE_LOW");
      title = sanitizeTitleForEbay(
        verifiedPack.verified_title,
        input.supplierTitle ?? input.marketplaceTitle ?? undefined
      );
      description = `${verifiedPack.verified_description}\n\nHighlights\n${verifiedPack.verified_bullet_points
        .map((bullet) => `- ${bullet}`)
        .join("\n")}`.trim();
      payload.title = title;
      payload.description = description;
      payload.categoryId = verifiedPack.verified_category_id || payload.categoryId;
      payload.itemSpecifics = verifiedPack.verified_item_specifics;
      payload.pricingHint = listingPack.pack.pricing_hint;
      payload.trustFlags = listingPack.pack.trust_flags;
      aiMetadata = {
        enabled: true,
        listingPackGenerated: true,
        schemaPassed: true,
        manualReviewRequired: lowVerificationConfidence || lowConfidence || verifiedPack.review_required,
        reason: lowVerificationConfidence
          ? "LISTING_VERIFICATION_LOW_CONFIDENCE"
          : lowConfidence
            ? "LISTING_PACK_LOW_CONFIDENCE"
            : verifiedPack.review_required
              ? "LISTING_VERIFICATION_REVIEW_REQUIRED"
              : null,
        trustFlags: listingPack.pack.trust_flags,
        confidence: listingPack.pack.confidence,
        generatedPack: listingPack.pack,
        verifiedPack,
        correctedFields: verifiedPack.corrected_fields,
        removedClaims: verifiedPack.removed_claims,
        riskFlags: verifiedPack.risk_flags,
        verificationConfidence: verifiedPack.verification_confidence,
        lowVerificationConfidence,
        diagnostics: {
          lowVerificationConfidence,
          generation: listingPack.diagnostics,
          verification: verification.ok
            ? verification.diagnostics
            : {
                schemaPassed: false,
                reason: verification.reason,
                diagnostics: verification.diagnostics,
              },
        },
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
