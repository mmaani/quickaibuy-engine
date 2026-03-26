import { looksLikeProviderBlockPayload } from "./suppliers/parserSignals";
import type { ShippingEstimate } from "./suppliers/types";
import type { AvailabilitySignal } from "./supplierAvailability";
import type { SupplierSnapshotQuality } from "./supplierQuality";

export type SupplierEvidenceReasonCode =
  | "SUPPLIER_OUT_OF_STOCK"
  | "SUPPLIER_LOW_STOCK"
  | "SUPPLIER_BLOCKED"
  | "SOURCE_CHALLENGE_PAGE"
  | "SOURCE_PROVIDER_BLOCK"
  | "AVAILABILITY_NOT_CONFIRMED"
  | "SHIPPING_SIGNAL_MISSING"
  | "SHIPPING_SIGNAL_WEAK"
  | "MEDIA_SIGNAL_WEAK"
  | "SUPPLIER_SIGNAL_INSUFFICIENT";

type SupplierEvidenceClassificationInput = {
  availabilitySignal: AvailabilitySignal;
  availabilityConfidence?: number | null;
  shippingEstimates?: ShippingEstimate[] | unknown;
  shippingConfidence?: number | null;
  mediaQualityScore?: number | null;
  imageCount?: number | null;
  sourceQuality?: SupplierSnapshotQuality | null;
  rawPayload?: Record<string, unknown> | null;
  telemetrySignals?: string[] | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
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
    "AVAILABILITY_NOT_CONFIRMED",
    "SHIPPING_SIGNAL_MISSING",
    "SHIPPING_SIGNAL_WEAK",
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
    } else if (
      input.availabilitySignal === "UNKNOWN" ||
      (input.availabilityConfidence != null && input.availabilityConfidence < 0.5)
    ) {
      codes.add("AVAILABILITY_NOT_CONFIRMED");
    }
  }

  if (!codes.has("SOURCE_PROVIDER_BLOCK") && !codes.has("SOURCE_CHALLENGE_PAGE") && !codes.has("SUPPLIER_BLOCKED")) {
    const shippingSignal = String(rawPayload.shippingSignal ?? "").trim().toUpperCase();
    const shippingEvidenceText =
      asString(rawPayload.shippingEvidenceText) ?? asString(rawPayload.shippingMethod) ?? asString(rawPayload.shippingBadge);
    const shippingConfidence = input.shippingConfidence ?? asNumber(rawPayload.shippingConfidence);
    const hasShippingEstimate = hasMeaningfulShippingEstimate(input.shippingEstimates);

    if (shippingSignal === "MISSING" || (!hasShippingEstimate && !shippingEvidenceText && (shippingConfidence ?? 0) < 0.35)) {
      codes.add("SHIPPING_SIGNAL_MISSING");
    } else if (
      shippingSignal === "INFERRED" ||
      (!hasShippingEstimate && Boolean(shippingEvidenceText)) ||
      (shippingConfidence != null && shippingConfidence < 0.75)
    ) {
      codes.add("SHIPPING_SIGNAL_WEAK");
    }

    const mediaQualityScore = input.mediaQualityScore ?? asNumber(rawPayload.mediaQualityScore);
    const imageCount = input.imageCount ?? asNumber(rawPayload.imageGalleryCount);
    if (
      (mediaQualityScore != null && mediaQualityScore < 0.82) ||
      (imageCount != null && imageCount > 0 && imageCount < 3) ||
      input.sourceQuality === "LOW" ||
      input.sourceQuality === "STUB"
    ) {
      codes.add("MEDIA_SIGNAL_WEAK");
    }

    if (
      String(rawPayload.actionableSnapshot ?? "").trim().toLowerCase() === "false" ||
      telemetry.has("fallback") ||
      telemetry.has("low_quality") ||
      input.sourceQuality === "LOW" ||
      input.sourceQuality === "STUB"
    ) {
      codes.add("SUPPLIER_SIGNAL_INSUFFICIENT");
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
