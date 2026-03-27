import type { InsertRawProductInput } from "@/lib/db/productsRaw";
import { sanitizeForMediaStorageMode } from "@/lib/media/storage";
import type { SupplierProduct } from "@/lib/products/suppliers/types";
import {
  normalizeAvailabilityConfidence,
  normalizeAvailabilitySignal,
} from "@/lib/products/supplierAvailability";
import { buildSupplierEnrichment } from "@/lib/products/supplierEnrichment";
import { resolveSupplierQualityPayload } from "@/lib/products/supplierQuality";

function normalizeSupplierKey(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "cj dropshipping") return "cjdropshipping";
  return normalized;
}

function buildPersistedShippingEstimates(
  productShippingEstimates: SupplierProduct["shippingEstimates"],
  enrichment: ReturnType<typeof buildSupplierEnrichment>
): SupplierProduct["shippingEstimates"] {
  const existing = Array.isArray(productShippingEstimates) ? productShippingEstimates : [];
  const normalizedEstimate =
    enrichment.shippingMethod != null ||
    enrichment.shippingPriceExplicit != null ||
    enrichment.deliveryEstimateMinDays != null ||
    enrichment.deliveryEstimateMaxDays != null ||
    enrichment.shipFromCountry != null ||
    enrichment.shipFromLocation != null
      ? [
          {
            label: enrichment.shippingMethod ?? "shipping signal",
            cost: enrichment.shippingPriceExplicit,
            currency: enrichment.shippingCurrency,
            etaMinDays: enrichment.deliveryEstimateMinDays,
            etaMaxDays: enrichment.deliveryEstimateMaxDays,
            ship_from_country: enrichment.shipFromCountry,
            ship_from_location: enrichment.shipFromLocation,
          },
        ]
      : [];

  if (!existing.length) return normalizedEstimate;
  if (!normalizedEstimate.length) return existing;

  return existing.map((estimate, index) =>
    index === 0
      ? {
          ...estimate,
          label: estimate.label ?? normalizedEstimate[0].label,
          cost: estimate.cost ?? normalizedEstimate[0].cost,
          currency: estimate.currency ?? normalizedEstimate[0].currency,
          etaMinDays: estimate.etaMinDays ?? normalizedEstimate[0].etaMinDays,
          etaMaxDays: estimate.etaMaxDays ?? normalizedEstimate[0].etaMaxDays,
          ship_from_country: estimate.ship_from_country ?? normalizedEstimate[0].ship_from_country,
          ship_from_location: estimate.ship_from_location ?? normalizedEstimate[0].ship_from_location,
        }
      : estimate
  );
}

export function supplierProductToRawInsert(product: SupplierProduct): InsertRawProductInput {
  const snapshotTs = new Date(product.snapshotTs);
  const availabilitySignal = normalizeAvailabilitySignal(
    product.availabilitySignal ?? product.raw?.availabilitySignal ?? product.raw?.availability_status
  );
  const rawConfidence = normalizeAvailabilityConfidence(
    typeof product.availabilityConfidence === "number"
      ? product.availabilityConfidence
      : product.raw?.availabilityConfidence ?? product.raw?.availability_confidence
  );
  const evidenceQualityRaw = String(product.raw?.availabilityEvidenceQuality ?? "").trim().toUpperCase();
  const availabilityEvidenceQuality =
    evidenceQualityRaw === "HIGH" || evidenceQualityRaw === "MEDIUM" || evidenceQualityRaw === "LOW"
      ? evidenceQualityRaw
      : "UNKNOWN";
  const availabilityEvidencePresent =
    typeof product.raw?.availabilityEvidencePresent === "boolean"
      ? product.raw.availabilityEvidencePresent
      : false;
  const availabilityConfidence =
    availabilityEvidenceQuality === "LOW" && availabilitySignal === "UNKNOWN"
      ? Math.min(rawConfidence ?? 0.2, 0.2)
      : rawConfidence;
  const enrichment = buildSupplierEnrichment({
    title: product.title,
    sourceUrl: product.sourceUrl,
    images: product.images,
    shippingEstimates: product.shippingEstimates,
    availabilitySignal,
    availabilityConfidence,
    rawPayload: product.raw,
    telemetrySignals: product.telemetrySignals ?? [],
  });
  const enrichedTitle = enrichment.cleanedTitle ?? product.title;
  const enrichedImages = enrichment.normalizedImageUrls.length
    ? enrichment.normalizedImageUrls
    : product.images;
  const persistedShippingEstimates = buildPersistedShippingEstimates(product.shippingEstimates, enrichment);
  const quality = resolveSupplierQualityPayload({
    rawPayload: product.raw,
    availabilitySignal,
    availabilityConfidence,
    price: product.price,
    title: enrichedTitle,
    sourceUrl: product.sourceUrl,
    images: enrichedImages,
    shippingEstimates: persistedShippingEstimates,
    telemetrySignals: product.telemetrySignals,
  });
  const sanitizedRawPayload = sanitizeForMediaStorageMode({
    ...product.raw,
    jobType: "supplier:discover",
    keyword: product.keyword,
    title: enrichedTitle,
    price: product.price,
    currency: product.currency,
    images: enrichedImages,
    variants: product.variants,
    shippingEstimates: persistedShippingEstimates,
    sourceUrl: product.sourceUrl,
    supplierProductId: product.supplierProductId,
    snapshotTs: product.snapshotTs,
    platform: product.platform,
    availabilitySignal,
    availabilityConfidence,
    availabilityEvidencePresent,
    availabilityEvidenceQuality,
    snapshotQuality: product.snapshotQuality ?? quality.snapshotQuality,
    telemetrySignals: quality.telemetrySignals,
    telemetry: quality.telemetry,
    primaryImageUrl: enrichment.primaryImageUrl,
    normalizedImageUrls: enrichment.normalizedImageUrls,
    imageGalleryCount: enrichment.imageGalleryCount,
    cleanedTitle: enrichment.cleanedTitle,
    titleCompleteness: enrichment.titleCompleteness,
    mediaQualityScore: enrichment.mediaQualityScore,
    shippingPriceExplicit: enrichment.shippingPriceExplicit,
    shippingCurrency: enrichment.shippingCurrency,
    freeShippingExplicit: enrichment.freeShippingExplicit,
    shippingMethod: enrichment.shippingMethod,
    shippingSignal: enrichment.shippingSignal,
    shippingStability: enrichment.shippingStability,
    deliveryEstimateMinDays: enrichment.deliveryEstimateMinDays,
    deliveryEstimateMaxDays: enrichment.deliveryEstimateMaxDays,
    shipFromCountry: enrichment.shipFromCountry,
    ship_from_country: enrichment.shipFromCountry,
    shipFromLocation: enrichment.shipFromLocation,
    ship_from_location: enrichment.shipFromLocation,
    shipFromConfidence: enrichment.shipFromConfidence,
    shippingOriginEvidenceSource: enrichment.shippingOriginEvidenceSource,
    stockCount: enrichment.stockCount,
    evidenceSource: enrichment.evidenceSource,
    detailQuality: enrichment.detailQuality,
    enrichmentQuality: enrichment.enrichmentQuality,
    shippingGuarantees: enrichment.shippingGuarantees,
    shippingConfidence: enrichment.shippingConfidence,
    pageIntegrityActionable: enrichment.pageIntegrityActionable,
    actionableSnapshot: enrichment.actionableSnapshot,
    supplierRowDecision: enrichment.supplierRowDecision,
  });
  const resolvedSnapshotQuality =
    product.snapshotQuality === "HIGH" ||
    quality.snapshotQuality === "HIGH"
      ? "HIGH"
      : product.snapshotQuality === "MEDIUM" || quality.snapshotQuality === "MEDIUM"
        ? "MEDIUM"
        : product.snapshotQuality === "LOW" || quality.snapshotQuality === "LOW"
          ? "LOW"
          : "STUB";

  return {
    supplierKey: normalizeSupplierKey(String(product.platform ?? "")),
    supplierProductId: product.supplierProductId ?? product.sourceUrl,
    sourceUrl: product.sourceUrl,
    title: enrichedTitle,
    images: enrichedImages,
    variants: product.variants,
    currency: product.currency,
    priceMin: product.price,
    priceMax: product.price,
    availabilityStatus: availabilitySignal,
    shippingEstimates: persistedShippingEstimates,
    rawPayload: {
      ...sanitizedRawPayload,
      snapshotQuality: resolvedSnapshotQuality,
    },
    snapshotTs,
  };
}
