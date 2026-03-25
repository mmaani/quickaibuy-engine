import type { InsertRawProductInput } from "@/lib/db/productsRaw";
import { sanitizeForMediaStorageMode } from "@/lib/media/storage";
import type { SupplierProduct } from "@/lib/products/suppliers/types";
import {
  normalizeAvailabilityConfidence,
  normalizeAvailabilitySignal,
} from "@/lib/products/supplierAvailability";
import { buildSupplierEnrichment } from "@/lib/products/supplierEnrichment";
import { resolveSupplierQualityPayload } from "@/lib/products/supplierQuality";

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
  const quality = resolveSupplierQualityPayload({
    rawPayload: product.raw,
    availabilitySignal,
    availabilityConfidence,
    price: product.price,
    title: enrichedTitle,
    sourceUrl: product.sourceUrl,
    images: enrichedImages,
    shippingEstimates: product.shippingEstimates,
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
    shippingEstimates: product.shippingEstimates,
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
    freeShippingExplicit: enrichment.freeShippingExplicit,
    shippingMethod: enrichment.shippingMethod,
    deliveryEstimateMinDays: enrichment.deliveryEstimateMinDays,
    deliveryEstimateMaxDays: enrichment.deliveryEstimateMaxDays,
    shippingConfidence: enrichment.shippingConfidence,
    pageIntegrityActionable: enrichment.pageIntegrityActionable,
    actionableSnapshot: enrichment.actionableSnapshot,
    supplierRowDecision: enrichment.supplierRowDecision,
  });

  return {
    supplierKey: String(product.platform ?? "").trim().toLowerCase(),
    supplierProductId: product.supplierProductId ?? product.sourceUrl,
    sourceUrl: product.sourceUrl,
    title: enrichedTitle,
    images: enrichedImages,
    variants: product.variants,
    currency: product.currency,
    priceMin: product.price,
    priceMax: product.price,
    availabilityStatus: availabilitySignal,
    shippingEstimates: product.shippingEstimates,
    rawPayload: sanitizedRawPayload,
    snapshotTs,
  };
}
