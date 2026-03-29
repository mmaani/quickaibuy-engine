import type { SupplierProduct, SupplierSnapshotQuality } from "@/lib/products/suppliers/types";

export type SupplierIntelligenceSignal = {
  supplierKey: string;
  basePriority: number;
  stockEvidenceStrength: number;
  shippingEvidenceStrength: number;
  apiStabilityScore: number;
  refreshSuccessRate: number | null;
  reliabilityScore: number;
  shouldDeprioritize: boolean;
};

export type SupplierWaveBudget = {
  supplierKey: string;
  searchMultiplier: number;
  minimumSearchLimit: number;
  minimumReliabilityScore: number;
  maximumPersistShare: number;
  requireStrongStockEvidence: boolean;
  requireStrongShippingEvidence: boolean;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function canonicalSupplierKey(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "cj dropshipping" || normalized === "cjdropshipping") return "cjdropshipping";
  if (normalized === "ali_express") return "aliexpress";
  return normalized;
}

export function supplierBasePriorityScore(supplierKey: string): number {
  const normalized = canonicalSupplierKey(supplierKey);
  if (normalized === "cjdropshipping") return 1;
  if (normalized === "temu") return 0.82;
  if (normalized === "alibaba") return 0.7;
  if (normalized === "aliexpress") return 0.38;
  return 0.5;
}

export function getDefaultSupplierWaveBudgets(): SupplierWaveBudget[] {
  return [
    {
      supplierKey: "cjdropshipping",
      searchMultiplier: 2.4,
      minimumSearchLimit: 10,
      minimumReliabilityScore: 0.58,
      maximumPersistShare: 0.7,
      requireStrongStockEvidence: false,
      requireStrongShippingEvidence: false,
    },
    {
      supplierKey: "temu",
      searchMultiplier: 2,
      minimumSearchLimit: 8,
      minimumReliabilityScore: 0.6,
      maximumPersistShare: 0.55,
      requireStrongStockEvidence: false,
      requireStrongShippingEvidence: false,
    },
    {
      supplierKey: "alibaba",
      searchMultiplier: 1.2,
      minimumSearchLimit: 6,
      minimumReliabilityScore: 0.62,
      maximumPersistShare: 0.4,
      requireStrongStockEvidence: false,
      requireStrongShippingEvidence: true,
    },
    {
      supplierKey: "aliexpress",
      searchMultiplier: 0.35,
      minimumSearchLimit: 3,
      minimumReliabilityScore: 0.78,
      maximumPersistShare: 0.15,
      requireStrongStockEvidence: true,
      requireStrongShippingEvidence: true,
    },
  ];
}

export function getSupplierWaveBudget(supplierKey: string): SupplierWaveBudget {
  const normalized = canonicalSupplierKey(supplierKey);
  return (
    getDefaultSupplierWaveBudgets().find((budget) => budget.supplierKey === normalized) ?? {
      supplierKey: normalized,
      searchMultiplier: 1,
      minimumSearchLimit: 4,
      minimumReliabilityScore: 0.62,
      maximumPersistShare: 0.25,
      requireStrongStockEvidence: false,
      requireStrongShippingEvidence: false,
    }
  );
}

export function computeStockEvidenceStrength(input: {
  availabilitySignal?: unknown;
  availabilityConfidence?: unknown;
  rawPayload?: unknown;
  snapshotQuality?: unknown;
}): number {
  const raw = asObject(input.rawPayload) ?? {};
  const signal = String(
    input.availabilitySignal ??
      raw.availabilitySignal ??
      raw.availability_status ??
      raw.availabilityStatus ??
      ""
  )
    .trim()
    .toUpperCase();
  const confidence = toNum(
    input.availabilityConfidence ?? raw.availabilityConfidence ?? raw.availability_confidence
  );
  const evidenceQuality = String(raw.availabilityEvidenceQuality ?? "").trim().toUpperCase();
  const evidencePresent = raw.availabilityEvidencePresent === true;
  const snapshotQuality = String(input.snapshotQuality ?? raw.snapshotQuality ?? "").trim().toUpperCase();

  let score = 0.1;
  if (signal === "IN_STOCK") score += 0.4;
  else if (signal === "LOW_STOCK") score += 0.28;
  else if (signal === "OUT_OF_STOCK") score += 0.12;
  if (confidence != null) score += clamp01(confidence) * 0.28;
  if (evidencePresent) score += 0.08;
  if (evidenceQuality === "HIGH") score += 0.1;
  else if (evidenceQuality === "MEDIUM") score += 0.05;
  if (snapshotQuality === "HIGH") score += 0.04;
  else if (snapshotQuality === "LOW" || snapshotQuality === "STUB") score -= 0.08;

  if (signal === "UNKNOWN" && !evidencePresent) score -= 0.15;
  return clamp01(score);
}

export function computeShippingEvidenceStrength(input: {
  shippingEstimates?: unknown;
  rawPayload?: unknown;
  shippingConfidence?: unknown;
}): number {
  const raw = asObject(input.rawPayload) ?? {};
  const estimates = Array.isArray(input.shippingEstimates)
    ? (input.shippingEstimates as Array<Record<string, unknown>>)
    : [];
  const shippingSignal = String(raw.shippingSignal ?? "").trim().toUpperCase();
  const explicitConfidence = toNum(input.shippingConfidence ?? raw.shippingConfidence);
  const estimateHasData = estimates.some((estimate) => {
    return (
      estimate?.cost != null ||
      estimate?.etaMinDays != null ||
      estimate?.etaMaxDays != null ||
      estimate?.label != null ||
      estimate?.ship_from_country != null
    );
  });
  const shippingMethod = String(raw.shippingMethod ?? raw.shippingBadge ?? "").trim();
  const sourceType = String(raw.shippingSourceType ?? raw.sourceType ?? "").trim().toLowerCase();

  let score = 0.08;
  if (estimateHasData) score += 0.42;
  if (shippingMethod) score += 0.08;
  if (shippingSignal === "EXACT" || shippingSignal === "STRONG") score += 0.2;
  else if (shippingSignal === "INFERRED") score += 0.08;
  else if (shippingSignal === "MISSING") score -= 0.18;
  if (explicitConfidence != null) score += clamp01(explicitConfidence) * 0.18;
  if (sourceType.includes("supplier_quote") || sourceType.includes("product_detail")) score += 0.08;
  return clamp01(score);
}

export function computeSupplierApiStabilityScore(input: {
  supplierKey: string;
  rawPayload?: unknown;
  refreshSuccessRate?: number | null;
}): number {
  const supplierKey = canonicalSupplierKey(input.supplierKey);
  const raw = asObject(input.rawPayload) ?? {};
  const telemetrySignals = new Set(
    Array.isArray(raw.telemetrySignals)
      ? raw.telemetrySignals.map((value) => String(value).toLowerCase())
      : []
  );
  const crawlStatus = String(raw.crawlStatus ?? "").trim().toUpperCase();
  const fetchError = String(raw.fetchError ?? "").trim();
  const refreshSuccessRate = input.refreshSuccessRate == null ? null : clamp01(input.refreshSuccessRate);

  let score = supplierKey === "cjdropshipping" ? 0.9 : supplierKey === "temu" ? 0.72 : supplierKey === "alibaba" ? 0.65 : 0.42;
  if (telemetrySignals.has("challenge") || crawlStatus === "CHALLENGE_PAGE") score -= 0.25;
  if (telemetrySignals.has("fallback")) score -= 0.12;
  if (telemetrySignals.has("low_quality")) score -= 0.12;
  if (fetchError.includes("429")) score -= 0.3;
  if (refreshSuccessRate != null) score = score * 0.55 + refreshSuccessRate * 0.45;
  return clamp01(score);
}

export function computeSupplierIntelligenceSignal(input: {
  supplierKey: string;
  availabilitySignal?: unknown;
  availabilityConfidence?: unknown;
  shippingEstimates?: unknown;
  rawPayload?: unknown;
  shippingConfidence?: unknown;
  snapshotQuality?: SupplierSnapshotQuality | unknown;
  refreshSuccessRate?: number | null;
}): SupplierIntelligenceSignal {
  const supplierKey = canonicalSupplierKey(input.supplierKey);
  const basePriority = supplierBasePriorityScore(supplierKey);
  const stockEvidenceStrength = computeStockEvidenceStrength({
    availabilitySignal: input.availabilitySignal,
    availabilityConfidence: input.availabilityConfidence,
    rawPayload: input.rawPayload,
    snapshotQuality: input.snapshotQuality,
  });
  const shippingEvidenceStrength = computeShippingEvidenceStrength({
    shippingEstimates: input.shippingEstimates,
    rawPayload: input.rawPayload,
    shippingConfidence: input.shippingConfidence,
  });
  const apiStabilityScore = computeSupplierApiStabilityScore({
    supplierKey,
    rawPayload: input.rawPayload,
    refreshSuccessRate: input.refreshSuccessRate ?? null,
  });

  let reliabilityScore =
    basePriority * 0.34 +
    stockEvidenceStrength * 0.24 +
    shippingEvidenceStrength * 0.27 +
    apiStabilityScore * 0.15;

  const shouldDeprioritize =
    supplierKey === "aliexpress" &&
    (stockEvidenceStrength < 0.55 || shippingEvidenceStrength < 0.65 || apiStabilityScore < 0.5);

  if (shouldDeprioritize) reliabilityScore *= 0.68;
  return {
    supplierKey,
    basePriority: clamp01(basePriority),
    stockEvidenceStrength,
    shippingEvidenceStrength,
    apiStabilityScore,
    refreshSuccessRate: input.refreshSuccessRate ?? null,
    reliabilityScore: clamp01(reliabilityScore),
    shouldDeprioritize,
  };
}

export function compareSupplierIntelligence(
  left: SupplierIntelligenceSignal,
  right: SupplierIntelligenceSignal
): number {
  if (left.reliabilityScore !== right.reliabilityScore) {
    return right.reliabilityScore - left.reliabilityScore;
  }
  if (left.shippingEvidenceStrength !== right.shippingEvidenceStrength) {
    return right.shippingEvidenceStrength - left.shippingEvidenceStrength;
  }
  if (left.stockEvidenceStrength !== right.stockEvidenceStrength) {
    return right.stockEvidenceStrength - left.stockEvidenceStrength;
  }
  if (left.apiStabilityScore !== right.apiStabilityScore) {
    return right.apiStabilityScore - left.apiStabilityScore;
  }
  return right.basePriority - left.basePriority;
}

export function computeSupplierIntelligenceForDiscover(item: SupplierProduct): SupplierIntelligenceSignal {
  return computeSupplierIntelligenceSignal({
    supplierKey: item.platform,
    availabilitySignal: item.availabilitySignal,
    availabilityConfidence: item.availabilityConfidence,
    shippingEstimates: item.shippingEstimates,
    rawPayload: item.raw,
    shippingConfidence: item.raw?.shippingConfidence,
    snapshotQuality: item.snapshotQuality,
  });
}
