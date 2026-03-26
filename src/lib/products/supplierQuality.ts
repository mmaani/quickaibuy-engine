import { normalizeAvailabilityConfidence, normalizeAvailabilitySignal, type AvailabilitySignal } from "./supplierAvailability";

export type SupplierSnapshotQuality = "HIGH" | "MEDIUM" | "LOW" | "STUB";
export type SupplierTelemetrySignal = "parsed" | "fallback" | "challenge" | "low_quality";
export type SupplierTelemetryFlags = Record<SupplierTelemetrySignal, boolean>;
export type SupplierQualityResolution = {
  snapshotQuality: SupplierSnapshotQuality;
  telemetrySignals: SupplierTelemetrySignal[];
  telemetry: SupplierTelemetryFlags;
  changed: boolean;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "TRUE" || value === 1 || value === "1";
}

function readTelemetrySignalSet(rawPayload: Record<string, unknown>): Set<SupplierTelemetrySignal> {
  const set = new Set<SupplierTelemetrySignal>();
  const direct = rawPayload.telemetrySignals;

  if (Array.isArray(direct)) {
    for (const value of direct) {
      const normalized = String(value ?? "").trim().toLowerCase();
      if (normalized === "parsed" || normalized === "fallback" || normalized === "challenge" || normalized === "low_quality") {
        set.add(normalized);
      }
    }
  }

  const telemetryObject = asObject(rawPayload.telemetry);
  if (telemetryObject) {
    for (const key of ["parsed", "fallback", "challenge", "low_quality"] as const) {
      if (asBoolean(telemetryObject[key])) set.add(key);
    }
  }

  const crawlStatus = String(rawPayload.crawlStatus ?? "").trim().toUpperCase();
  const parseMode = String(rawPayload.parseMode ?? "").trim().toLowerCase();
  if (crawlStatus === "PARSED") set.add("parsed");
  if (parseMode === "fallback" || crawlStatus === "NO_PRODUCTS_PARSED" || crawlStatus === "FETCH_FAILED") {
    set.add("fallback");
  }
  if (crawlStatus === "CHALLENGE_PAGE" || asBoolean(rawPayload.pageChallengeDetected)) {
    set.add("challenge");
  }

  return set;
}

export function normalizeSupplierSnapshotQuality(value: unknown): SupplierSnapshotQuality | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "HIGH" || normalized === "MEDIUM" || normalized === "LOW" || normalized === "STUB") {
    return normalized;
  }
  return null;
}

export function normalizeSupplierTelemetry(rawPayload: unknown): {
  signals: SupplierTelemetrySignal[];
  flags: SupplierTelemetryFlags;
} {
  const payload = asObject(rawPayload) ?? {};
  const signalSet = readTelemetrySignalSet(payload);
  const snapshotQuality = normalizeSupplierSnapshotQuality(payload.snapshotQuality);

  if (
    snapshotQuality === "LOW" ||
    snapshotQuality === "STUB" ||
    asBoolean(payload.lowQuality) ||
    asBoolean(payload.low_quality)
  ) {
    signalSet.add("low_quality");
  }

  const flags: SupplierTelemetryFlags = {
    parsed: signalSet.has("parsed"),
    fallback: signalSet.has("fallback"),
    challenge: signalSet.has("challenge"),
    low_quality: signalSet.has("low_quality"),
  };

  return {
    signals: (["parsed", "fallback", "challenge", "low_quality"] as const).filter((key) => flags[key]),
    flags,
  };
}

export function classifySupplierSnapshotQuality(input: {
  rawPayload?: unknown;
  availabilitySignal?: unknown;
  availabilityConfidence?: unknown;
  price?: unknown;
  title?: unknown;
  sourceUrl?: unknown;
  images?: unknown;
  shippingEstimates?: unknown;
}): SupplierSnapshotQuality {
  const payload = asObject(input.rawPayload) ?? {};
  const direct = normalizeSupplierSnapshotQuality(payload.snapshotQuality);
  const telemetry = normalizeSupplierTelemetry(payload);
  const availabilitySignal = normalizeAvailabilitySignal(
    input.availabilitySignal ?? payload.availabilitySignal ?? payload.availability_status
  );
  const availabilityConfidence = normalizeAvailabilityConfidence(
    input.availabilityConfidence ?? payload.availabilityConfidence ?? payload.availability_confidence
  );
  const pricePresent = asString(input.price ?? payload.price ?? payload.priceText ?? payload.price_text) != null;
  const titlePresent = asString(input.title ?? payload.title) != null;
  const sourceUrlPresent = asString(input.sourceUrl ?? payload.sourceUrl ?? payload.searchUrl) != null;
  const listingValidity = String(payload.listingValidity ?? "").trim().toUpperCase();
  const listingValid = listingValidity !== "INVALID";
  const shippingEstimates =
    Array.isArray(input.shippingEstimates) ? input.shippingEstimates : Array.isArray(payload.shippingEstimates) ? payload.shippingEstimates : [];
  const images = Array.isArray(input.images) ? input.images : Array.isArray(payload.images) ? payload.images : [];
  const evidencePresent = asBoolean(payload.availabilityEvidencePresent);
  const evidenceQuality = String(payload.availabilityEvidenceQuality ?? "").trim().toUpperCase();

  const minimal = !pricePresent && !titlePresent && images.length === 0 && shippingEstimates.length === 0;
  const fallbackOnly =
    telemetry.flags.fallback &&
    !telemetry.flags.parsed &&
    availabilitySignal === "UNKNOWN" &&
    (availabilityConfidence ?? 0) <= 0.25;

  let inferred: SupplierSnapshotQuality;
  if (fallbackOnly && minimal) {
    inferred = "STUB";
  } else if (!listingValid || telemetry.flags.challenge) {
    inferred = minimal ? "STUB" : "LOW";
  } else if (
    sourceUrlPresent &&
    titlePresent &&
    pricePresent &&
    availabilitySignal !== "UNKNOWN" &&
    (availabilityConfidence ?? 0) >= 0.7 &&
    evidencePresent &&
    (shippingEstimates.length > 0 || images.length > 0) &&
    !telemetry.flags.low_quality
  ) {
    inferred = "HIGH";
  } else if (
    pricePresent &&
    titlePresent &&
    sourceUrlPresent &&
    (availabilitySignal !== "UNKNOWN" || evidenceQuality === "MEDIUM" || shippingEstimates.length > 0)
  ) {
    inferred = "MEDIUM";
  } else if (minimal) {
    inferred = "STUB";
  } else {
    inferred = "LOW";
  }

  if (!direct) return inferred;
  return qualityRank(direct) > qualityRank(inferred) ? direct : inferred;
}

export function buildSupplierSnapshotQualityPayload(input: {
  rawPayload?: Record<string, unknown>;
  availabilitySignal?: AvailabilitySignal | unknown;
  availabilityConfidence?: number | null | unknown;
  price?: string | null | unknown;
  title?: string | null | unknown;
  sourceUrl?: string | null | unknown;
  images?: unknown;
  shippingEstimates?: unknown;
  telemetrySignals?: SupplierTelemetrySignal[] | unknown;
}): {
  snapshotQuality: SupplierSnapshotQuality;
  telemetrySignals: SupplierTelemetrySignal[];
  telemetry: SupplierTelemetryFlags;
} {
  const basePayload = { ...(input.rawPayload ?? {}) };
  if (Array.isArray(input.telemetrySignals)) {
    basePayload.telemetrySignals = input.telemetrySignals;
  }

  const snapshotQuality = classifySupplierSnapshotQuality({
    rawPayload: basePayload,
    availabilitySignal: input.availabilitySignal,
    availabilityConfidence: input.availabilityConfidence,
    price: input.price,
    title: input.title,
    sourceUrl: input.sourceUrl,
    images: input.images,
    shippingEstimates: input.shippingEstimates,
  });
  basePayload.snapshotQuality = snapshotQuality;

  const telemetry = normalizeSupplierTelemetry(basePayload);
  if ((snapshotQuality === "LOW" || snapshotQuality === "STUB") && !telemetry.flags.low_quality) {
    telemetry.flags.low_quality = true;
  }

  const telemetrySignals = (["parsed", "fallback", "challenge", "low_quality"] as const).filter((key) => telemetry.flags[key]);
  return {
    snapshotQuality,
    telemetrySignals,
    telemetry: {
      parsed: telemetrySignals.includes("parsed"),
      fallback: telemetrySignals.includes("fallback"),
      challenge: telemetrySignals.includes("challenge"),
      low_quality: telemetrySignals.includes("low_quality"),
    },
  };
}

function qualityRank(value: SupplierSnapshotQuality | null): number {
  if (value === "HIGH") return 4;
  if (value === "MEDIUM") return 3;
  if (value === "LOW") return 2;
  if (value === "STUB") return 1;
  return 0;
}

function buildTelemetryFlags(signals: SupplierTelemetrySignal[]): SupplierTelemetryFlags {
  return {
    parsed: signals.includes("parsed"),
    fallback: signals.includes("fallback"),
    challenge: signals.includes("challenge"),
    low_quality: signals.includes("low_quality"),
  };
}

function sortTelemetrySignals(signals: Iterable<SupplierTelemetrySignal>): SupplierTelemetrySignal[] {
  const signalSet = new Set(signals);
  return (["parsed", "fallback", "challenge", "low_quality"] as const).filter((key) => signalSet.has(key));
}

function sameSignals(a: SupplierTelemetrySignal[], b: SupplierTelemetrySignal[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function resolveSupplierQualityPayload(input: {
  rawPayload?: Record<string, unknown> | null;
  availabilitySignal?: AvailabilitySignal | unknown;
  availabilityConfidence?: number | null | unknown;
  price?: string | null | unknown;
  title?: string | null | unknown;
  sourceUrl?: string | null | unknown;
  images?: unknown;
  shippingEstimates?: unknown;
  telemetrySignals?: SupplierTelemetrySignal[] | unknown;
}): SupplierQualityResolution {
  const currentPayload = { ...(input.rawPayload ?? {}) };
  const currentSnapshotQuality = normalizeSupplierSnapshotQuality(currentPayload.snapshotQuality);
  const currentTelemetry = normalizeSupplierTelemetry(currentPayload);
  const derived = buildSupplierSnapshotQualityPayload({
    rawPayload: currentPayload,
    availabilitySignal: input.availabilitySignal,
    availabilityConfidence: input.availabilityConfidence,
    price: input.price,
    title: input.title,
    sourceUrl: input.sourceUrl,
    images: input.images,
    shippingEstimates: input.shippingEstimates,
    telemetrySignals: input.telemetrySignals,
  });

  const snapshotQuality =
    qualityRank(currentSnapshotQuality) >= qualityRank(derived.snapshotQuality)
      ? (currentSnapshotQuality ?? derived.snapshotQuality)
      : derived.snapshotQuality;
  const telemetrySignals = sortTelemetrySignals([
    ...currentTelemetry.signals,
    ...derived.telemetrySignals,
  ]);
  const telemetry = buildTelemetryFlags(telemetrySignals);
  const currentTelemetrySignals = sortTelemetrySignals(currentTelemetry.signals);
  const currentTelemetryFlags = buildTelemetryFlags(currentTelemetrySignals);
  const changed =
    snapshotQuality !== currentSnapshotQuality ||
    !sameSignals(currentTelemetrySignals, telemetrySignals) ||
    currentTelemetryFlags.parsed !== telemetry.parsed ||
    currentTelemetryFlags.fallback !== telemetry.fallback ||
    currentTelemetryFlags.challenge !== telemetry.challenge ||
    currentTelemetryFlags.low_quality !== telemetry.low_quality;

  return {
    snapshotQuality,
    telemetrySignals,
    telemetry,
    changed,
  };
}
