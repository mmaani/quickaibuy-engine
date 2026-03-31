import { looksLikeProviderBlockPayload } from "./suppliers/parserSignals";
import type { ShippingEstimate } from "./suppliers/types";
import type { AvailabilitySignal } from "./supplierAvailability";
import type { SupplierSnapshotQuality } from "./supplierQuality";
import { deriveCanonicalMediaTruth, deriveCanonicalShippingTruth } from "./canonicalTruth";

export type SupplierEvidenceReasonCode =
  | "SUPPLIER_OUT_OF_STOCK"
  | "SUPPLIER_LOW_STOCK"
  | "SUPPLIER_BLOCKED"
  | "SOURCE_CHALLENGE_PAGE"
  | "SOURCE_PROVIDER_BLOCK"
  | "AVAILABILITY_NOT_CONFIRMED"
  | "UNKNOWN_AVAILABILITY"
  | "LOW_CONFIDENCE_AVAILABILITY"
  | "SHIPPING_SIGNAL_MISSING"
  | "SHIPPING_TRANSPARENCY_INCOMPLETE"
  | "SHIP_FROM_MISSING"
  | "SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT"
  | "SHIPPING_SIGNAL_WEAK"
  | "MEDIA_MISSING"
  | "MEDIA_PRESENT_QUALITY_WEAK"
  | "MEDIA_SIGNAL_WEAK"
  | "SUPPLIER_SIGNAL_INSUFFICIENT";

type SupplierEvidenceClassificationInput = {
  availabilitySignal: AvailabilitySignal;
  availabilityConfidence?: number | null;
  shippingEstimates?: ShippingEstimate[] | unknown;
  shippingConfidence?: number | null;
  mediaQualityScore?: number | null;
  imageCount?: number | null;
  videoCount?: number | null;
  sourceQuality?: SupplierSnapshotQuality | null;
  rawPayload?: Record<string, unknown> | null;
  telemetrySignals?: string[] | null;
  canonicalShipping?: {
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
  } | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function countVideoEntries(rawPayload: Record<string, unknown>, mediaNode: Record<string, unknown> | null): number | null {
  const topLevel =
    Array.isArray(rawPayload.videoUrls)
      ? rawPayload.videoUrls.length
      : Array.isArray(rawPayload.videos)
        ? rawPayload.videos.length
        : null;
  const nested =
    Array.isArray(mediaNode?.videoUrls)
      ? mediaNode.videoUrls.length
      : Array.isArray(mediaNode?.videos)
        ? mediaNode.videos.length
        : null;
  const direct = asNumber(rawPayload.videoCount) ?? asNumber(mediaNode?.videoCount);
  return direct ?? topLevel ?? nested;
}

function hasMeaningfulShippingEstimate(value: ShippingEstimate[] | unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((estimate) => {
    if (!estimate || typeof estimate !== "object") return false;
    const candidate = estimate as ShippingEstimate;
    const label = String(candidate.label ?? "").trim().toLowerCase();
    return (
      candidate.cost != null ||
      candidate.etaMinDays != null ||
      candidate.etaMaxDays != null ||
      Boolean(label) ||
      label.includes("free shipping") ||
      label.includes("express") ||
      label.includes("choice")
    );
  });
}

function sortCodes(codes: Iterable<SupplierEvidenceReasonCode>): SupplierEvidenceReasonCode[] {
  const priority: SupplierEvidenceReasonCode[] = [
    "SOURCE_PROVIDER_BLOCK",
    "SOURCE_CHALLENGE_PAGE",
    "SUPPLIER_BLOCKED",
    "SUPPLIER_OUT_OF_STOCK",
    "SUPPLIER_LOW_STOCK",
    "UNKNOWN_AVAILABILITY",
    "LOW_CONFIDENCE_AVAILABILITY",
    "AVAILABILITY_NOT_CONFIRMED",
    "SHIPPING_SIGNAL_MISSING",
    "SHIPPING_TRANSPARENCY_INCOMPLETE",
    "SHIP_FROM_MISSING",
    "SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT",
    "SHIPPING_SIGNAL_WEAK",
    "MEDIA_MISSING",
    "MEDIA_PRESENT_QUALITY_WEAK",
    "MEDIA_SIGNAL_WEAK",
    "SUPPLIER_SIGNAL_INSUFFICIENT",
  ];
  const set = new Set(codes);
  return priority.filter((code) => set.has(code));
}

export function classifySupplierEvidence(
  input: SupplierEvidenceClassificationInput
): {
  codes: SupplierEvidenceReasonCode[];
  dominantCode: SupplierEvidenceReasonCode | null;
  blocked: boolean;
  manualReview: boolean;
} {
  const rawPayload = input.rawPayload ?? {};
  const telemetry = new Set((input.telemetrySignals ?? []).map((value) => String(value).toLowerCase()));
  const codes = new Set<SupplierEvidenceReasonCode>();

  const crawlStatus = String(rawPayload.crawlStatus ?? "").trim().toUpperCase();
  const challengeDetected = crawlStatus === "CHALLENGE_PAGE" || telemetry.has("challenge") || rawPayload.pageChallengeDetected === true;
  const blockedEvidenceText = [
    asString(rawPayload.challengeHint),
    asString(rawPayload.pageTextSample),
    asString(rawPayload.fetchError),
    asString(rawPayload.listingValidityReason),
    asString(rawPayload.detailTextSample),
    asString(rawPayload.nearbyTextSample),
  ]
    .filter(Boolean)
    .join(" ");
  const providerBlocked = looksLikeProviderBlockPayload(blockedEvidenceText);

  if (providerBlocked) {
    codes.add("SOURCE_PROVIDER_BLOCK");
  } else if (challengeDetected) {
    codes.add("SOURCE_CHALLENGE_PAGE");
  } else if (
    crawlStatus === "FETCH_FAILED" ||
    (String(rawPayload.supplierRowDecision ?? "").trim().toUpperCase() === "BLOCKED" &&
      (telemetry.has("fallback") || telemetry.has("low_quality")))
  ) {
    codes.add("SUPPLIER_BLOCKED");
  }

  if (!codes.size) {
    if (input.availabilitySignal === "OUT_OF_STOCK") {
      codes.add("SUPPLIER_OUT_OF_STOCK");
    } else if (input.availabilitySignal === "LOW_STOCK") {
      codes.add("SUPPLIER_LOW_STOCK");
    } else if (input.availabilitySignal === "UNKNOWN") {
      codes.add("UNKNOWN_AVAILABILITY");
      codes.add("AVAILABILITY_NOT_CONFIRMED");
    } else if (input.availabilityConfidence != null && input.availabilityConfidence < 0.5) {
      codes.add("LOW_CONFIDENCE_AVAILABILITY");
      codes.add("AVAILABILITY_NOT_CONFIRMED");
    }
  }

  if (!codes.has("SOURCE_PROVIDER_BLOCK") && !codes.has("SOURCE_CHALLENGE_PAGE") && !codes.has("SUPPLIER_BLOCKED")) {
    const shippingSignal = String(rawPayload.shippingSignal ?? "").trim().toUpperCase();
    const shippingNode = nestedRecord(rawPayload.shipping);
    const canonicalShipping = deriveCanonicalShippingTruth({
      shippingValidity: input.canonicalShipping?.shippingValidity,
      transparencyState: input.canonicalShipping?.transparencyState,
      originCountry: input.canonicalShipping?.originCountry,
      originConfidence: input.canonicalShipping?.originConfidence,
      sourceConfidence: input.canonicalShipping?.sourceConfidence,
      shippingErrorReason: input.canonicalShipping?.shippingErrorReason,
      resolutionMode: input.canonicalShipping?.resolutionMode,
      deliveryEstimateMinDays: input.canonicalShipping?.deliveryEstimateMinDays,
      deliveryEstimateMaxDays: input.canonicalShipping?.deliveryEstimateMaxDays,
      shippingCostUsd: input.canonicalShipping?.shippingCostUsd,
    });
    const hasStructuredShippingNode =
      shippingNode != null &&
      Object.values(shippingNode).some((value) => {
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
        return value != null && String(value).trim() !== "";
      });
    const destinationContextPresent =
      asString(rawPayload.shippingDestinationCountry) != null ||
      asString(rawPayload.shipping_destination_country) != null ||
      asString(rawPayload.destinationCountry) != null ||
      asString(shippingNode?.destinationCountry) != null ||
      asString(shippingNode?.destination_country) != null;
    const shipFromCountry =
      asString(rawPayload.shipFromCountry) ??
      asString(rawPayload.ship_from_country) ??
      asString(rawPayload.supplierWarehouseCountry) ??
      asString(rawPayload.supplier_warehouse_country) ??
      asString(shippingNode?.shipFromCountry) ??
      asString(shippingNode?.ship_from_country);
    const shipFromLocation =
      asString(rawPayload.shipFromLocation) ??
      asString(rawPayload.ship_from_location) ??
      asString(rawPayload.shipsFromHint) ??
      asString(shippingNode?.shipFromLocation) ??
      asString(shippingNode?.ship_from_location);
    const shippingEvidenceText =
      asString(rawPayload.shippingEvidenceText) ??
      asString(rawPayload.shippingMethod) ??
      asString(rawPayload.shippingBadge) ??
      asString(shippingNode?.method) ??
      asString(shippingNode?.badge) ??
      asString(shippingNode?.summary);
    const shippingConfidence =
      input.shippingConfidence ??
      asNumber(rawPayload.shippingConfidence) ??
      asNumber(shippingNode?.confidence) ??
      asNumber(shippingNode?.score);
    const hasShippingEstimate =
      hasMeaningfulShippingEstimate(input.shippingEstimates) ||
      hasMeaningfulShippingEstimate(rawPayload.shippingEstimates) ||
      hasMeaningfulShippingEstimate(shippingNode?.estimates);
    const estimateShipFromEvidence = [
      ...(Array.isArray(input.shippingEstimates) ? input.shippingEstimates : []),
      ...(Array.isArray(rawPayload.shippingEstimates) ? (rawPayload.shippingEstimates as ShippingEstimate[]) : []),
      ...(Array.isArray(shippingNode?.estimates) ? (shippingNode.estimates as ShippingEstimate[]) : []),
    ].some((estimate) => asString(estimate?.ship_from_country) != null || asString(estimate?.ship_from_location) != null);
    const hasTransparentShippingEvidence =
      hasShippingEstimate ||
      hasStructuredShippingNode ||
      (shippingEvidenceText != null &&
        (shippingEvidenceText.toLowerCase().includes("delivery") ||
          shippingEvidenceText.toLowerCase().includes("arrive") ||
          shippingEvidenceText.toLowerCase().includes("ship")));
    const hasShipFromEvidence = Boolean(shipFromCountry || shipFromLocation || estimateShipFromEvidence);
    const shippingTransparencyIncompleteSignal =
      shippingSignal === "PARTIAL" ||
      shippingSignal === "INFERRED" ||
      asString(rawPayload.shippingTransparencyState)?.toUpperCase() === "INCOMPLETE";

    if (canonicalShipping.passed) {
      codes.delete("SHIPPING_SIGNAL_MISSING");
      codes.delete("SHIPPING_SIGNAL_WEAK");
      codes.delete("SHIPPING_TRANSPARENCY_INCOMPLETE");
      codes.delete("SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT");
      codes.delete("SHIP_FROM_MISSING");
    } else {
      if (
        (shippingSignal === "MISSING" && !hasTransparentShippingEvidence && !hasShipFromEvidence) ||
        (!hasShippingEstimate && !shippingEvidenceText && !hasStructuredShippingNode && (shippingConfidence ?? 0) < 0.35)
      ) {
        codes.add("SHIPPING_SIGNAL_MISSING");
      } else if (
        canonicalShipping.weak ||
        shippingSignal === "INFERRED" ||
        (!hasShippingEstimate && !hasStructuredShippingNode && Boolean(shippingEvidenceText)) ||
        (shippingConfidence != null && shippingConfidence < 0.75)
      ) {
        codes.add("SHIPPING_SIGNAL_WEAK");
      }
      if (canonicalShipping.transparencyIncomplete || (shippingTransparencyIncompleteSignal && hasTransparentShippingEvidence)) {
        codes.add("SHIPPING_TRANSPARENCY_INCOMPLETE");
      }
      if (canonicalShipping.originUnresolved || (!hasShipFromEvidence && destinationContextPresent)) {
        codes.add("SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT");
      } else if (!hasShipFromEvidence && hasTransparentShippingEvidence) {
        codes.add("SHIP_FROM_MISSING");
      }
    }

    const mediaNode = nestedRecord(rawPayload.media);
    const structuredImageCount = new Set(
      [
        ...(Array.isArray(rawPayload.images) ? rawPayload.images : []),
        ...(hasNonEmptyArray(rawPayload.imageGallery) ? (rawPayload.imageGallery as unknown[]) : []),
        ...(hasNonEmptyArray(rawPayload.galleryImages) ? (rawPayload.galleryImages as unknown[]) : []),
        ...(hasNonEmptyArray(rawPayload.variantImages) ? (rawPayload.variantImages as unknown[]) : []),
        ...(hasNonEmptyArray(rawPayload.descriptionImages) ? (rawPayload.descriptionImages as unknown[]) : []),
        ...(Array.isArray(mediaNode?.images) ? (mediaNode?.images as unknown[]) : []),
        ...(Array.isArray(mediaNode?.galleryImages) ? (mediaNode?.galleryImages as unknown[]) : []),
        ...(Array.isArray(mediaNode?.variantImages) ? (mediaNode?.variantImages as unknown[]) : []),
        ...(Array.isArray(mediaNode?.descriptionImages) ? (mediaNode?.descriptionImages as unknown[]) : []),
      ]
        .map((value) => asString(value) ?? JSON.stringify(value))
        .filter(Boolean)
    ).size;
    const imageCount = input.imageCount ??
      asNumber(rawPayload.imageGalleryCount) ??
      asNumber(mediaNode?.imageCount) ??
      (structuredImageCount > 0 ? structuredImageCount : null);
    const videoCount = input.videoCount ?? countVideoEntries(rawPayload, mediaNode);
    const effectiveImageCount = imageCount ?? (structuredImageCount > 0 ? structuredImageCount : null);
    const canonicalMedia = deriveCanonicalMediaTruth({
      rawPayload,
      imageCount: effectiveImageCount,
      videoCount,
      mediaQualityScore: input.mediaQualityScore,
    });
    const mediaPresent = canonicalMedia.present;
    if (!mediaPresent) {
      codes.add("MEDIA_MISSING");
    }
    if (canonicalMedia.strength === "WEAK" || input.sourceQuality === "LOW" || input.sourceQuality === "STUB") {
      if (mediaPresent) codes.add("MEDIA_PRESENT_QUALITY_WEAK");
      codes.add("MEDIA_SIGNAL_WEAK");
    }

    const weakSignalCount = [
      codes.has("AVAILABILITY_NOT_CONFIRMED"),
      codes.has("SHIPPING_SIGNAL_MISSING"),
      codes.has("SHIPPING_SIGNAL_WEAK"),
      codes.has("SHIPPING_TRANSPARENCY_INCOMPLETE"),
      codes.has("SHIP_FROM_MISSING"),
      codes.has("SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT"),
      codes.has("MEDIA_MISSING"),
      codes.has("MEDIA_PRESENT_QUALITY_WEAK"),
    ].filter(Boolean).length;

    const actionableSnapshotValue = String(rawPayload.actionableSnapshot ?? "").trim().toLowerCase();
    if (
      actionableSnapshotValue === "false" ||
      telemetry.has("fallback") ||
      telemetry.has("low_quality") ||
      ((input.sourceQuality === "LOW" || input.sourceQuality === "STUB") && weakSignalCount >= 2) ||
      weakSignalCount >= 3
    ) {
      codes.add("SUPPLIER_SIGNAL_INSUFFICIENT");
    }
    if (
      codes.has("SUPPLIER_SIGNAL_INSUFFICIENT") &&
      !codes.has("AVAILABILITY_NOT_CONFIRMED") &&
      !codes.has("SHIPPING_SIGNAL_MISSING") &&
      !codes.has("SHIPPING_SIGNAL_WEAK") &&
      !codes.has("SHIPPING_TRANSPARENCY_INCOMPLETE") &&
      !codes.has("SHIP_FROM_MISSING") &&
      !codes.has("SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT") &&
      !codes.has("MEDIA_MISSING") &&
      !codes.has("MEDIA_PRESENT_QUALITY_WEAK") &&
      actionableSnapshotValue !== "false" &&
      !telemetry.has("fallback") &&
      !telemetry.has("low_quality")
    ) {
      codes.delete("SUPPLIER_SIGNAL_INSUFFICIENT");
    }
  }

  const orderedCodes = sortCodes(codes);
  const dominantCode = orderedCodes[0] ?? null;
  const blockingOrManualReviewCodes = new Set<SupplierEvidenceReasonCode>([
    "SOURCE_PROVIDER_BLOCK",
    "SOURCE_CHALLENGE_PAGE",
    "SUPPLIER_BLOCKED",
    "SUPPLIER_OUT_OF_STOCK",
  ]);
  return {
    codes: orderedCodes,
    dominantCode,
    blocked: orderedCodes.some((code) =>
      code === "SOURCE_PROVIDER_BLOCK" ||
      code === "SOURCE_CHALLENGE_PAGE" ||
      code === "SUPPLIER_BLOCKED" ||
      code === "SUPPLIER_OUT_OF_STOCK"
    ),
    manualReview: orderedCodes.some((code) => blockingOrManualReviewCodes.has(code)),
  };
}

export function formatSupplierEvidenceBlockReason(codes: SupplierEvidenceReasonCode[]): string | null {
  if (!codes.length) return null;
  return `supplier evidence review required: ${codes.join(", ")}`;
}
