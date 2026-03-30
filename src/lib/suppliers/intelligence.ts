import type { SupplierProduct, SupplierSnapshotQuality } from "@/lib/products/suppliers/types";

export type SupplierIntelligenceSignal = {
  supplierKey: string;
  basePriority: number;
  destinationCountry: string | null;
  originAvailabilityRate: number;
  shippingTransparencyRate: number;
  stockReliabilityRate: number;
  stockEvidenceStrength: number;
  shippingEvidenceStrength: number;
  apiStabilityScore: number;
  refreshSuccessRate: number | null;
  historicalSuccessRate: number | null;
  rateLimitPressure: number;
  usMarketPriority: number;
  hasStrongOriginEvidence: boolean;
  hasUsWarehouse: boolean;
  lowStockOrWorse: boolean;
  hardBlock: boolean;
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

function normalizeCountry(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "USA" || normalized === "US" || normalized === "UNITED STATES") return "US";
  if (normalized === "CN" || normalized === "CHINA") return "CN";
  if (normalized === "GB" || normalized === "UK" || normalized === "UNITED KINGDOM") return "GB";
  if (normalized === "DE" || normalized === "GERMANY") return "DE";
  if (normalized === "PL" || normalized === "POLAND") return "PL";
  if (normalized === "CA" || normalized === "CANADA") return "CA";
  if (normalized === "AU" || normalized === "AUSTRALIA") return "AU";
  return normalized.length <= 3 ? normalized : null;
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
      searchMultiplier: 2.8,
      minimumSearchLimit: 12,
      minimumReliabilityScore: 0.55,
      maximumPersistShare: 0.8,
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
      searchMultiplier: 0.2,
      minimumSearchLimit: 2,
      minimumReliabilityScore: 0.82,
      maximumPersistShare: 0.08,
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

function computeOriginAvailabilityRate(input: {
  shippingEstimates?: unknown;
  rawPayload?: unknown;
  destinationCountry?: string | null;
}): {
  rate: number;
  hasStrongOriginEvidence: boolean;
  hasUsWarehouse: boolean;
} {
  const raw = asObject(input.rawPayload) ?? {};
  const shippingNode = asObject(raw.shipping);
  const destinationCountry = normalizeCountry(input.destinationCountry) ?? null;
  const estimates = Array.isArray(input.shippingEstimates)
    ? (input.shippingEstimates as Array<Record<string, unknown>>)
    : [];
  const estimateOrigins = estimates
    .map((estimate) => normalizeCountry(estimate?.ship_from_country))
    .filter((value): value is string => Boolean(value));
  const rawOrigins = [
    raw.shipFromCountry,
    raw.ship_from_country,
    raw.shippingOriginCountry,
    raw.originCountry,
    raw.supplierWarehouseCountry,
    raw.supplier_warehouse_country,
    shippingNode?.shipFromCountry,
    shippingNode?.ship_from_country,
    shippingNode?.originCountry,
    shippingNode?.warehouseCountry,
  ]
    .map((value) => normalizeCountry(value))
    .filter((value): value is string => Boolean(value));
  const originValidity = String(
    raw.shippingOriginValidity ?? raw.originValidity ?? shippingNode?.originValidity ?? ""
  )
    .trim()
    .toUpperCase();
  const warehouseCountry = normalizeCountry(raw.supplierWarehouseCountry ?? shippingNode?.warehouseCountry);
  const originCountry = normalizeCountry(
    raw.shippingOriginCountry ?? raw.shipFromCountry ?? raw.originCountry ?? shippingNode?.originCountry
  );
  const hasStrongOriginEvidence =
    originValidity === "EXPLICIT" ||
    originValidity === "STRONG_INFERRED" ||
    originCountry != null ||
    estimateOrigins.length > 0 ||
    warehouseCountry != null;
  const hasUsWarehouse = warehouseCountry === "US" || estimateOrigins.includes("US") || originCountry === "US";

  let rate = hasStrongOriginEvidence ? 0.82 : 0.08;
  if (originValidity === "EXPLICIT") rate = 0.98;
  else if (originValidity === "STRONG_INFERRED") rate = 0.86;
  else if (estimateOrigins.length > 0 && rawOrigins.length > 0) rate = 0.9;
  else if (estimateOrigins.length > 0 || rawOrigins.length > 0) rate = 0.76;
  if (destinationCountry === "US" && !hasStrongOriginEvidence) rate = 0;
  if (hasUsWarehouse) rate = 1;

  return {
    rate: clamp01(rate),
    hasStrongOriginEvidence: destinationCountry === "US" ? hasStrongOriginEvidence : rate >= 0.75,
    hasUsWarehouse,
  };
}

function computeShippingTransparencyRate(input: {
  shippingEstimates?: unknown;
  rawPayload?: unknown;
}): number {
  const raw = asObject(input.rawPayload) ?? {};
  const shippingNode = asObject(raw.shipping);
  const estimates = Array.isArray(input.shippingEstimates)
    ? (input.shippingEstimates as Array<Record<string, unknown>>)
    : [];
  const hasEstimateData = estimates.some((estimate) => {
    return (
      estimate?.cost != null ||
      estimate?.etaMinDays != null ||
      estimate?.etaMaxDays != null ||
      estimate?.label != null
    );
  });
  const transparencyState = String(
    raw.shippingTransparencyState ?? raw.shipping_transparency_state ?? shippingNode?.shippingTransparencyState ?? ""
  )
    .trim()
    .toUpperCase();
  const shippingSignal = String(raw.shippingSignal ?? "").trim().toUpperCase();
  const hasStructuredNode =
    shippingNode != null &&
    Object.values(shippingNode).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
      return value != null && String(value).trim() !== "";
    });

  let rate = 0.12;
  if (hasEstimateData) rate += 0.42;
  if (hasStructuredNode) rate += 0.22;
  if (shippingSignal === "DIRECT" || shippingSignal === "EXACT" || shippingSignal === "STRONG") rate += 0.2;
  else if (shippingSignal === "PARTIAL") rate += 0.1;
  else if (shippingSignal === "MISSING") rate -= 0.24;
  if (transparencyState === "PRESENT") rate += 0.18;
  else if (transparencyState === "MISSING" || transparencyState === "INCOMPLETE") rate -= 0.18;
  return clamp01(rate);
}

function computeStockReliabilityRate(input: {
  availabilitySignal?: unknown;
  availabilityConfidence?: unknown;
  rawPayload?: unknown;
}): { rate: number; lowStockOrWorse: boolean } {
  const raw = asObject(input.rawPayload) ?? {};
  const signal = String(
    input.availabilitySignal ?? raw.availabilitySignal ?? raw.availability_status ?? raw.availabilityStatus ?? ""
  )
    .trim()
    .toUpperCase();
  const confidence = toNum(
    input.availabilityConfidence ?? raw.availabilityConfidence ?? raw.availability_confidence
  );
  const lowStockOrWorse = signal === "LOW_STOCK" || signal === "OUT_OF_STOCK" || signal === "UNKNOWN";

  let rate = signal === "IN_STOCK" ? 0.84 : signal === "LOW_STOCK" ? 0.28 : signal === "OUT_OF_STOCK" ? 0.05 : 0.12;
  if (confidence != null) rate = rate * 0.72 + clamp01(confidence) * 0.28;
  return { rate: clamp01(rate), lowStockOrWorse };
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
  destinationCountry?: string | null;
  availabilitySignal?: unknown;
  availabilityConfidence?: unknown;
  shippingEstimates?: unknown;
  rawPayload?: unknown;
  shippingConfidence?: unknown;
  snapshotQuality?: SupplierSnapshotQuality | unknown;
  refreshSuccessRate?: number | null;
  historicalSuccessRate?: number | null;
  rateLimitEvents?: number | null;
  refreshAttempts?: number | null;
}): SupplierIntelligenceSignal {
  const supplierKey = canonicalSupplierKey(input.supplierKey);
  const destinationCountry = normalizeCountry(input.destinationCountry) ?? null;
  const basePriority = supplierBasePriorityScore(supplierKey);
  const { rate: originAvailabilityRate, hasStrongOriginEvidence, hasUsWarehouse } = computeOriginAvailabilityRate({
    shippingEstimates: input.shippingEstimates,
    rawPayload: input.rawPayload,
    destinationCountry,
  });
  const shippingTransparencyRate = computeShippingTransparencyRate({
    shippingEstimates: input.shippingEstimates,
    rawPayload: input.rawPayload,
  });
  const { rate: stockReliabilityRate, lowStockOrWorse } = computeStockReliabilityRate({
    availabilitySignal: input.availabilitySignal,
    availabilityConfidence: input.availabilityConfidence,
    rawPayload: input.rawPayload,
  });
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
  const refreshAttempts = Math.max(0, Number(input.refreshAttempts ?? 0) || 0);
  const rateLimitEvents = Math.max(0, Number(input.rateLimitEvents ?? 0) || 0);
  const rateLimitPressure = clamp01(
    refreshAttempts > 0 ? rateLimitEvents / refreshAttempts : rateLimitEvents > 0 ? 1 : 0
  );
  const historicalSuccessRate =
    input.historicalSuccessRate != null
      ? clamp01(input.historicalSuccessRate)
      : input.refreshSuccessRate != null
        ? clamp01(input.refreshSuccessRate)
        : null;
  const usMarketPriority =
    destinationCountry === "US"
      ? hasUsWarehouse
        ? 1
        : hasStrongOriginEvidence
          ? 0.82
          : 0
      : hasStrongOriginEvidence
        ? 0.72
        : 0.45;

  let reliabilityScore =
    basePriority * 0.12 +
    originAvailabilityRate * 0.22 +
    shippingTransparencyRate * 0.16 +
    stockReliabilityRate * 0.18 +
    stockEvidenceStrength * 0.08 +
    shippingEvidenceStrength * 0.08 +
    apiStabilityScore * 0.08 +
    usMarketPriority * 0.08;

  if (historicalSuccessRate != null) reliabilityScore += historicalSuccessRate * 0.08;
  reliabilityScore -= rateLimitPressure * 0.12;

  const hardBlock =
    lowStockOrWorse ||
    (destinationCountry === "US" && !hasStrongOriginEvidence) ||
    shippingTransparencyRate < 0.45;

  const shouldDeprioritize =
    hardBlock ||
    (supplierKey === "aliexpress" &&
      (originAvailabilityRate < 0.82 ||
        shippingTransparencyRate < 0.78 ||
        stockReliabilityRate < 0.82 ||
        apiStabilityScore < 0.6)) ||
    reliabilityScore < 0.58;

  if (supplierKey === "cjdropshipping" && destinationCountry === "US" && hasStrongOriginEvidence && !lowStockOrWorse) {
    reliabilityScore += 0.08;
  }
  if (hardBlock) reliabilityScore *= 0.2;
  else if (shouldDeprioritize) reliabilityScore *= 0.55;
  return {
    supplierKey,
    basePriority: clamp01(basePriority),
    destinationCountry,
    originAvailabilityRate,
    shippingTransparencyRate,
    stockReliabilityRate,
    stockEvidenceStrength,
    shippingEvidenceStrength,
    apiStabilityScore,
    refreshSuccessRate: input.refreshSuccessRate ?? null,
    historicalSuccessRate,
    rateLimitPressure,
    usMarketPriority,
    hasStrongOriginEvidence,
    hasUsWarehouse,
    lowStockOrWorse,
    hardBlock,
    reliabilityScore: clamp01(reliabilityScore),
    shouldDeprioritize,
  };
}

export function compareSupplierIntelligence(
  left: SupplierIntelligenceSignal,
  right: SupplierIntelligenceSignal
): number {
  if (left.hardBlock !== right.hardBlock) {
    return Number(left.hardBlock) - Number(right.hardBlock);
  }
  if (left.reliabilityScore !== right.reliabilityScore) {
    return right.reliabilityScore - left.reliabilityScore;
  }
  if (left.usMarketPriority !== right.usMarketPriority) {
    return right.usMarketPriority - left.usMarketPriority;
  }
  if (left.originAvailabilityRate !== right.originAvailabilityRate) {
    return right.originAvailabilityRate - left.originAvailabilityRate;
  }
  if (left.shippingTransparencyRate !== right.shippingTransparencyRate) {
    return right.shippingTransparencyRate - left.shippingTransparencyRate;
  }
  if (left.stockReliabilityRate !== right.stockReliabilityRate) {
    return right.stockReliabilityRate - left.stockReliabilityRate;
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
    destinationCountry: "US",
    availabilitySignal: item.availabilitySignal,
    availabilityConfidence: item.availabilityConfidence,
    shippingEstimates: item.shippingEstimates,
    rawPayload: item.raw,
    shippingConfidence: item.raw?.shippingConfidence,
    snapshotQuality: item.snapshotQuality,
  });
}

export function shouldRejectSupplierEarly(input: {
  supplierKey: string;
  destinationCountry?: string | null;
  availabilitySignal?: unknown;
  availabilityConfidence?: unknown;
  shippingEstimates?: unknown;
  rawPayload?: unknown;
  shippingConfidence?: unknown;
  snapshotQuality?: SupplierSnapshotQuality | unknown;
  refreshSuccessRate?: number | null;
  historicalSuccessRate?: number | null;
  rateLimitEvents?: number | null;
  refreshAttempts?: number | null;
  minimumReliabilityScore?: number;
}): { reject: boolean; reason: string | null; signal: SupplierIntelligenceSignal } {
  const signal = computeSupplierIntelligenceSignal(input);
  const minimumReliabilityScore = clamp01(input.minimumReliabilityScore ?? 0.58);
  if (signal.lowStockOrWorse) {
    return { reject: true, reason: "low_stock_or_unconfirmed_availability", signal };
  }
  if (signal.destinationCountry === "US" && !signal.hasStrongOriginEvidence) {
    return { reject: true, reason: "us_origin_unresolved", signal };
  }
  if (signal.shippingTransparencyRate < 0.45) {
    return { reject: true, reason: "shipping_transparency_too_weak", signal };
  }
  if (signal.reliabilityScore < minimumReliabilityScore || signal.hardBlock) {
    return { reject: true, reason: "supplier_reliability_too_low", signal };
  }
  return { reject: false, reason: null, signal };
}
