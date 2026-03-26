import {
  normalizeAvailabilityConfidence,
  normalizeAvailabilitySignal,
  type AvailabilitySignal,
} from "./supplierAvailability";
import type { ShippingEstimate } from "./suppliers/types";

export type SupplierRowDecision = "ACTIONABLE" | "MANUAL_REVIEW" | "BLOCKED";

type SupplierEnrichmentInput = {
  title: string | null;
  sourceUrl: string | null;
  images: string[];
  shippingEstimates: ShippingEstimate[];
  availabilitySignal: AvailabilitySignal;
  availabilityConfidence: number | null;
  rawPayload?: Record<string, unknown> | null;
  telemetrySignals?: string[] | null;
};

export type SupplierEnrichment = {
  primaryImageUrl: string | null;
  imageGalleryCount: number;
  normalizedImageUrls: string[];
  cleanedTitle: string | null;
  titleCompleteness: number;
  mediaQualityScore: number;
  shippingPriceExplicit: string | null;
  freeShippingExplicit: boolean | null;
  shippingMethod: string | null;
  deliveryEstimateMinDays: number | null;
  deliveryEstimateMaxDays: number | null;
  shippingConfidence: number;
  availabilityStatus: AvailabilitySignal;
  availabilityConfidence: number | null;
  pageIntegrityActionable: boolean;
  actionableSnapshot: boolean;
  supplierRowDecision: SupplierRowDecision;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function asPositiveNumber(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function sanitizeTitle(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/[|]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  return cleaned || null;
}

function normalizeImageUrl(url: string): string | null {
  const normalized = String(url ?? "").trim().replace(/^http:\/\//i, "https://");
  if (!/^https?:\/\//i.test(normalized)) return null;
  return normalized;
}

function dedupeImages(images: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const image of images) {
    const value = normalizeImageUrl(image);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function computeTitleCompleteness(title: string | null): number {
  if (!title) return 0;
  const compact = title.trim();
  const wordCount = compact.split(/\s+/).filter(Boolean).length;
  let score = compact.length >= 20 ? 0.45 : 0.2;
  if (compact.length >= 45) score += 0.2;
  if (wordCount >= 4) score += 0.2;
  if (wordCount >= 7) score += 0.1;
  if (!/[a-z]{3,}/i.test(compact)) score -= 0.2;
  return clamp01(score);
}

function computeMediaQualityScore(input: {
  imageCount: number;
  titleCompleteness: number;
  actionableSnapshot: boolean;
  telemetrySignals: Set<string>;
  rawPayload: Record<string, unknown>;
}): number {
  const direct = asNumber(input.rawPayload.mediaQualityScore);
  if (direct != null) return clamp01(direct);

  let score = 0;
  if (input.imageCount >= 1) score += 0.35;
  if (input.imageCount >= 3) score += 0.2;
  if (input.imageCount >= 5) score += 0.15;
  score += input.titleCompleteness * 0.2;
  if (input.actionableSnapshot) score += 0.1;
  if (input.telemetrySignals.has("low_quality")) score -= 0.2;
  if (input.telemetrySignals.has("challenge") || input.telemetrySignals.has("fallback")) score -= 0.3;
  return clamp01(score);
}

function deriveShippingDetails(
  shippingEstimates: ShippingEstimate[],
  rawPayload: Record<string, unknown>
): {
  shippingPriceExplicit: string | null;
  freeShippingExplicit: boolean | null;
  shippingMethod: string | null;
  deliveryEstimateMinDays: number | null;
  deliveryEstimateMaxDays: number | null;
  shippingConfidence: number;
} {
  const directConfidence = normalizeAvailabilityConfidence(rawPayload.shippingConfidence);
  const rawShippingSignal = String(rawPayload.shippingSignal ?? "").trim().toUpperCase();
  const directMethod =
    asString(rawPayload.shippingMethod) ??
    asString(rawPayload.shippingBadge) ??
    asString(rawPayload.shippingEvidenceText);
  const directPrice = asString(rawPayload.shippingPriceExplicit);
  const directFree = asBoolean(rawPayload.freeShippingExplicit);
  const directMin = asPositiveNumber(rawPayload.deliveryEstimateMinDays);
  const directMax = asPositiveNumber(rawPayload.deliveryEstimateMaxDays);

  const estimate = shippingEstimates.find((candidate) => {
    const label = String(candidate.label ?? "").toLowerCase();
    return (
      candidate.cost != null ||
      candidate.etaMinDays != null ||
      candidate.etaMaxDays != null ||
      label.includes("free shipping") ||
      label.includes("choice") ||
      label.includes("express")
    );
  });

  const label = asString(estimate?.label);
  const shippingPriceExplicit = directPrice ?? asString(estimate?.cost);
  const freeShippingExplicit =
    directFree ??
    (shippingPriceExplicit != null ? Number(shippingPriceExplicit) === 0 : null) ??
    (label?.toLowerCase().includes("free shipping") ? true : null);
  const shippingMethod = directMethod ?? label;
  const deliveryEstimateMinDays = directMin ?? estimate?.etaMinDays ?? null;
  const deliveryEstimateMaxDays = directMax ?? estimate?.etaMaxDays ?? null;
  const hasShippingEvidence =
    shippingPriceExplicit != null ||
    freeShippingExplicit === true ||
    shippingMethod != null ||
    deliveryEstimateMinDays != null ||
    deliveryEstimateMaxDays != null;

  let shippingConfidence =
    directConfidence ??
    (deliveryEstimateMinDays != null || deliveryEstimateMaxDays != null || shippingPriceExplicit != null
      ? 0.9
      : shippingMethod && /(dollar express|choice|free shipping|fast delivery|express)/i.test(shippingMethod)
        ? 0.78
        : shippingMethod
          ? 0.62
          : 0.2);

  if (!hasShippingEvidence || rawShippingSignal === "MISSING") {
    shippingConfidence = Math.min(shippingConfidence, 0.2);
  }

  if (freeShippingExplicit === true && shippingConfidence < 0.82) {
    shippingConfidence = 0.82;
  }

  return {
    shippingPriceExplicit,
    freeShippingExplicit,
    shippingMethod,
    deliveryEstimateMinDays,
    deliveryEstimateMaxDays,
    shippingConfidence: clamp01(shippingConfidence),
  };
}

export function buildSupplierEnrichment(input: SupplierEnrichmentInput): SupplierEnrichment {
  const rawPayload = { ...(input.rawPayload ?? {}) };
  const telemetrySignals = new Set((input.telemetrySignals ?? []).map((value) => String(value).toLowerCase()));
  const cleanedTitle = sanitizeTitle(input.title);
  const normalizedImageUrls = dedupeImages(input.images);
  const imageGalleryCount = normalizedImageUrls.length;
  const primaryImageUrl = normalizedImageUrls[0] ?? null;
  const titleCompleteness = computeTitleCompleteness(cleanedTitle);
  const listingValidity = String(rawPayload.listingValidity ?? "").trim().toUpperCase();
  const hasChallenge = telemetrySignals.has("challenge") || rawPayload.pageChallengeDetected === true;
  const hasFallback = telemetrySignals.has("fallback");
  const hasRequiredFields = Boolean(cleanedTitle && primaryImageUrl && input.sourceUrl);
  const pageIntegrityActionable =
    !hasChallenge && listingValidity !== "INVALID" && String(rawPayload.crawlStatus ?? "").trim().toUpperCase() === "PARSED";
  const actionableSnapshot = pageIntegrityActionable && hasRequiredFields && !hasFallback;
  const mediaQualityScore = computeMediaQualityScore({
    imageCount: imageGalleryCount,
    titleCompleteness,
    actionableSnapshot,
    telemetrySignals,
    rawPayload,
  });
  const shipping = deriveShippingDetails(input.shippingEstimates, rawPayload);
  const availabilityStatus = normalizeAvailabilitySignal(input.availabilitySignal ?? rawPayload.availabilitySignal);
  const availabilityConfidence = normalizeAvailabilityConfidence(
    input.availabilityConfidence ?? rawPayload.availabilityConfidence
  );

  let supplierRowDecision: SupplierRowDecision = "MANUAL_REVIEW";
  if (!actionableSnapshot) {
    supplierRowDecision = "BLOCKED";
  } else if (
    mediaQualityScore >= 0.82 &&
    shipping.shippingConfidence >= 0.75 &&
    availabilityStatus === "IN_STOCK" &&
    (availabilityConfidence ?? 0) >= 0.6
  ) {
    supplierRowDecision = "ACTIONABLE";
  }

  return {
    primaryImageUrl,
    imageGalleryCount,
    normalizedImageUrls,
    cleanedTitle,
    titleCompleteness,
    mediaQualityScore,
    shippingPriceExplicit: shipping.shippingPriceExplicit,
    freeShippingExplicit: shipping.freeShippingExplicit,
    shippingMethod: shipping.shippingMethod,
    deliveryEstimateMinDays: shipping.deliveryEstimateMinDays,
    deliveryEstimateMaxDays: shipping.deliveryEstimateMaxDays,
    shippingConfidence: shipping.shippingConfidence,
    availabilityStatus,
    availabilityConfidence,
    pageIntegrityActionable,
    actionableSnapshot,
    supplierRowDecision,
  };
}
