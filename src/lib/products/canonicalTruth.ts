export type MediaEvidenceStrength = "MISSING" | "WEAK" | "MEDIUM" | "STRONG";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function collectArrayCount(...values: unknown[]): number {
  return values.reduce<number>((count, value) => count + (Array.isArray(value) ? value.length : 0), 0);
}

export function deriveCanonicalMediaTruth(input: {
  rawPayload?: Record<string, unknown> | null;
  imageCount?: number | null;
  videoCount?: number | null;
  mediaQualityScore?: number | null;
}): {
  present: boolean;
  imageCount: number;
  videoCount: number;
  mediaQualityScore: number;
  strength: MediaEvidenceStrength;
} {
  const rawPayload = input.rawPayload ?? {};
  const media = asObject(rawPayload.media);
  const imageCount =
    input.imageCount ??
    asNumber(rawPayload.imageGalleryCount) ??
    asNumber(media?.imageCount) ??
    collectArrayCount(
      rawPayload.images,
      rawPayload.imageGallery,
      rawPayload.galleryImages,
      rawPayload.variantImages,
      rawPayload.descriptionImages,
      media?.images,
      media?.galleryImages,
      media?.variantImages,
      media?.descriptionImages,
    );
  const videoCount =
    input.videoCount ??
    asNumber(rawPayload.videoCount) ??
    asNumber(media?.videoCount) ??
    collectArrayCount(rawPayload.videoUrls, rawPayload.videos, media?.videoUrls, media?.videos);
  const present = imageCount > 0 || videoCount > 0;
  const explicitScore =
    input.mediaQualityScore ??
    asNumber(rawPayload.mediaQualityScore) ??
    asNumber(media?.qualityScore) ??
    asNumber(media?.score);

  let mediaQualityScore = explicitScore != null && (explicitScore > 0 || !present) ? clamp01(explicitScore) : 0;
  if (present && mediaQualityScore <= 0) {
    if (imageCount >= 5) mediaQualityScore = 0.84;
    else if (imageCount >= 3) mediaQualityScore = 0.68;
    else if (imageCount >= 1) mediaQualityScore = 0.46;
    else if (videoCount > 0) mediaQualityScore = 0.52;
  }
  if (present && videoCount > 0) {
    mediaQualityScore = clamp01(Math.max(mediaQualityScore, Math.min(0.95, mediaQualityScore + 0.08)));
  }

  const strength: MediaEvidenceStrength =
    !present
      ? "MISSING"
      : mediaQualityScore >= 0.82
        ? "STRONG"
        : mediaQualityScore >= 0.6 || imageCount >= 3
          ? "MEDIUM"
          : "WEAK";

  return {
    present,
    imageCount,
    videoCount,
    mediaQualityScore,
    strength,
  };
}

export function deriveCanonicalShippingTruth(input: {
  shippingValidity?: unknown;
  transparencyState?: unknown;
  originCountry?: unknown;
  originConfidence?: unknown;
  sourceConfidence?: unknown;
  shippingErrorReason?: unknown;
  resolutionMode?: unknown;
  deliveryEstimateMinDays?: unknown;
  deliveryEstimateMaxDays?: unknown;
  shippingCostUsd?: unknown;
}): {
  hasSignal: boolean;
  passed: boolean;
  weak: boolean;
  transparencyIncomplete: boolean;
  originKnown: boolean;
  originUnresolved: boolean;
} {
  const shippingValidity = asString(input.shippingValidity)?.toUpperCase() ?? null;
  const transparencyState = asString(input.transparencyState)?.toUpperCase() ?? null;
  const originCountry = asString(input.originCountry)?.toUpperCase() ?? null;
  const originConfidence = asNumber(input.originConfidence);
  const sourceConfidence = asNumber(input.sourceConfidence);
  const shippingErrorReason = asString(input.shippingErrorReason)?.toUpperCase() ?? null;
  const resolutionMode = asString(input.resolutionMode)?.toUpperCase() ?? null;
  const minDays = asNumber(input.deliveryEstimateMinDays);
  const maxDays = asNumber(input.deliveryEstimateMaxDays);
  const shippingCostUsd = asNumber(input.shippingCostUsd);
  const originKnown = Boolean(originCountry);
  const hasSignal =
    shippingValidity === "PASS" ||
    transparencyState === "PRESENT" ||
    shippingCostUsd != null ||
    minDays != null ||
    maxDays != null ||
    originKnown;
  const passed =
    shippingValidity === "PASS" &&
    shippingErrorReason == null &&
    transparencyState === "PRESENT" &&
    originKnown;
  const transparencyIncomplete =
    !passed && (transparencyState === "INCOMPLETE" || transparencyState === "MISSING" || shippingErrorReason === "MISSING_SHIPPING_TRANSPARENCY");
  const originUnresolved =
    !passed && (shippingErrorReason === "MISSING_SHIP_FROM_COUNTRY" || (hasSignal && !originKnown));
  const weak =
    !passed &&
    (
      resolutionMode === "INFERRED_WEAK" ||
      (sourceConfidence != null && sourceConfidence < 0.75) ||
      (originConfidence != null && originConfidence < 0.75)
    );

  return {
    hasSignal,
    passed,
    weak,
    transparencyIncomplete,
    originKnown,
    originUnresolved,
  };
}
