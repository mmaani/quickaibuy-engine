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

export type SupplierTrustBand = "BLOCK" | "REVIEW" | "SAFE";
export type SupplierTrustReasonCode =
  | "DELIVERY_CONFIDENCE_LOW"
  | "STOCK_CONFIDENCE_LOW"
  | "PRICE_STABILITY_WEAK"
  | "ORIGIN_CLARITY_WEAK"
  | "ISSUE_TELEMETRY_PENALTY"
  | "SNAPSHOT_STALE"
  | "WEAK_EVIDENCE_FAIL_CLOSED"
  | "SNAPSHOT_LOW_QUALITY"
  | "FALLBACK_TELEMETRY"
  | "CHALLENGE_TELEMETRY";

export type SupplierTrustScorecard = {
  supplier_trust_score: number;
  supplier_trust_band: SupplierTrustBand;
  supplier_delivery_score: number;
  supplier_stock_score: number;
  supplier_price_stability_score: number;
  supplier_issue_penalty: number;
  supplier_trust_evaluated_at: string;
  supplier_trust_reason_codes: SupplierTrustReasonCode[];
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeSupplierTrustScore(input: {
  availabilitySignal?: unknown;
  availabilityConfidence?: unknown;
  snapshotAgeHours?: unknown;
  snapshotQuality?: unknown;
  shippingConfidence?: unknown;
  shippingTransparencyState?: unknown;
  shippingOriginValidity?: unknown;
  priceSeries?: unknown;
  issueRate?: unknown;
  issueCount?: unknown;
  telemetrySignals?: unknown;
  evaluatedAt?: Date;
}): SupplierTrustScorecard {
  const reasonCodes = new Set<SupplierTrustReasonCode>();
  const availabilitySignal = String(input.availabilitySignal ?? "").trim().toUpperCase();
  const availabilityConfidence = clamp01(toNum(input.availabilityConfidence) ?? 0.35);
  const shippingConfidence = clamp01(toNum(input.shippingConfidence) ?? 0.35);
  const snapshotAgeHours = toNum(input.snapshotAgeHours);
  const snapshotQuality = normalizeSupplierSnapshotQuality(input.snapshotQuality);
  const shippingTransparencyState = String(input.shippingTransparencyState ?? "")
    .trim()
    .toUpperCase();
  const originValidity = String(input.shippingOriginValidity ?? "").trim().toUpperCase();
  const issueRate = clamp01(toNum(input.issueRate) ?? 0);
  const issueCount = Math.max(0, Math.round(toNum(input.issueCount) ?? 0));
  const telemetry = Array.isArray(input.telemetrySignals)
    ? input.telemetrySignals.map((value) => String(value ?? "").trim().toLowerCase())
    : [];

  const deliveryBase = shippingConfidence;
  const deliveryTransparencyBoost = shippingTransparencyState === "PRESENT" ? 0.08 : -0.12;
  const deliverySnapshotAdjustment =
    snapshotQuality === "HIGH" ? 0.08 : snapshotQuality === "MEDIUM" ? 0.02 : -0.14;
  const supplier_delivery_score = clamp01(deliveryBase + deliveryTransparencyBoost + deliverySnapshotAdjustment);

  let supplier_stock_score = availabilityConfidence;
  if (availabilitySignal === "IN_STOCK") supplier_stock_score = clamp01(supplier_stock_score + 0.15);
  else if (availabilitySignal === "LOW_STOCK") supplier_stock_score = clamp01(supplier_stock_score - 0.1);
  else if (availabilitySignal === "OUT_OF_STOCK") supplier_stock_score = clamp01(supplier_stock_score - 0.35);
  else supplier_stock_score = clamp01(supplier_stock_score - 0.18);

  const prices = Array.isArray(input.priceSeries)
    ? input.priceSeries.map((value) => toNum(value)).filter((value): value is number => value != null && value > 0)
    : [];
  let supplier_price_stability_score = 0.45;
  if (prices.length >= 2) {
    const mean = prices.reduce((acc, value) => acc + value, 0) / prices.length;
    const variance = prices.reduce((acc, value) => acc + (value - mean) ** 2, 0) / prices.length;
    const coefficient = mean > 0 ? Math.sqrt(variance) / mean : 1;
    supplier_price_stability_score = clamp01(1 - coefficient * 2.6);
    if (supplier_price_stability_score < 0.45) reasonCodes.add("PRICE_STABILITY_WEAK");
  } else {
    supplier_price_stability_score = 0.35;
    reasonCodes.add("WEAK_EVIDENCE_FAIL_CLOSED");
    reasonCodes.add("PRICE_STABILITY_WEAK");
  }

  const hasStrongOrigin = originValidity === "EXPLICIT" || originValidity === "STRONG_INFERRED";
  const originConfidenceScore = hasStrongOrigin ? 1 : originValidity === "WEAK_INFERRED" ? 0.45 : 0.25;
  if (!hasStrongOrigin) reasonCodes.add("ORIGIN_CLARITY_WEAK");

  const stalePenalty = snapshotAgeHours == null ? 0.14 : snapshotAgeHours > 48 ? 0.2 : snapshotAgeHours > 24 ? 0.1 : 0;
  if (stalePenalty > 0) reasonCodes.add("SNAPSHOT_STALE");

  if (snapshotQuality === "LOW" || snapshotQuality === "STUB") reasonCodes.add("SNAPSHOT_LOW_QUALITY");
  if (telemetry.includes("fallback")) reasonCodes.add("FALLBACK_TELEMETRY");
  if (telemetry.includes("challenge")) reasonCodes.add("CHALLENGE_TELEMETRY");

  if (supplier_delivery_score < 0.45) reasonCodes.add("DELIVERY_CONFIDENCE_LOW");
  if (supplier_stock_score < 0.45) reasonCodes.add("STOCK_CONFIDENCE_LOW");
  if (snapshotQuality == null || availabilitySignal === "UNKNOWN") reasonCodes.add("WEAK_EVIDENCE_FAIL_CLOSED");

  const issueImpact = clamp01(issueRate * 0.8 + Math.min(0.35, issueCount / 30));
  const supplier_issue_penalty = clamp01(issueImpact);
  if (supplier_issue_penalty >= 0.12) reasonCodes.add("ISSUE_TELEMETRY_PENALTY");

  const weighted =
    supplier_delivery_score * 0.26 +
    supplier_stock_score * 0.24 +
    supplier_price_stability_score * 0.2 +
    originConfidenceScore * 0.18 +
    (snapshotQuality === "HIGH" ? 0.12 : snapshotQuality === "MEDIUM" ? 0.08 : 0.04);
  const score01 = clamp01(weighted - supplier_issue_penalty - stalePenalty);
  const supplier_trust_score = Math.round(score01 * 100);
  const supplier_trust_band: SupplierTrustBand =
    supplier_trust_score >= 80 ? "SAFE" : supplier_trust_score >= 60 ? "REVIEW" : "BLOCK";

  return {
    supplier_trust_score,
    supplier_trust_band,
    supplier_delivery_score: Number(supplier_delivery_score.toFixed(6)),
    supplier_stock_score: Number(supplier_stock_score.toFixed(6)),
    supplier_price_stability_score: Number(supplier_price_stability_score.toFixed(6)),
    supplier_issue_penalty: Number(supplier_issue_penalty.toFixed(6)),
    supplier_trust_evaluated_at: (input.evaluatedAt ?? new Date()).toISOString(),
    supplier_trust_reason_codes: Array.from(reasonCodes.values()),
  };
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
