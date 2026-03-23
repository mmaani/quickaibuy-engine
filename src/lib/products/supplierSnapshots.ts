import type { InsertRawProductInput } from "@/lib/db/productsRaw";
import { sanitizeForMediaStorageMode } from "@/lib/media/storage";
import type { SupplierProduct } from "@/lib/products/suppliers/types";
import {
  normalizeAvailabilityConfidence,
  normalizeAvailabilitySignal,
} from "@/lib/products/supplierAvailability";
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
  const quality = resolveSupplierQualityPayload({
    rawPayload: product.raw,
    availabilitySignal,
    availabilityConfidence,
    price: product.price,
    title: product.title,
    sourceUrl: product.sourceUrl,
    images: product.images,
    shippingEstimates: product.shippingEstimates,
    telemetrySignals: product.telemetrySignals,
  });
  const sanitizedRawPayload = sanitizeForMediaStorageMode({
    ...product.raw,
    jobType: "supplier:discover",
    keyword: product.keyword,
    title: product.title,
    price: product.price,
    currency: product.currency,
    images: product.images,
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
  });

  return {
    supplierKey: String(product.platform ?? "").trim().toLowerCase(),
    supplierProductId: product.supplierProductId ?? product.sourceUrl,
    sourceUrl: product.sourceUrl,
    title: product.title,
    images: product.images,
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
