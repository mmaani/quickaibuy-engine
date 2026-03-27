import type { ShippingEstimate } from "@/lib/products/suppliers/types";
import { normalizeShipFromCountry } from "@/lib/products/shipFromCountry";

export type ShippingInferenceMode =
  | "EXACT_QUOTE"
  | "SUPPLIER_DEFAULT"
  | "INFERRED_STRONG"
  | "INFERRED_WEAK"
  | "FALLBACK_DEFAULT"
  | "UNRESOLVED";

export type SupplierShippingProfile = {
  supplierKey: string;
  destinationCountry: string;
  sampleCount: number;
  averageCostUsd: number | null;
  averageMinDays: number | null;
  averageMaxDays: number | null;
  dominantOriginCountry: string | null;
  preferredMethods: string[];
  historicalConfidence: number | null;
  consistencyScore: number;
};

export type ShippingInferenceResult = {
  mode: ShippingInferenceMode;
  shippingCostUsd: number | null;
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  originCountry: string | null;
  confidence: number | null;
  sourceType: string;
  shippingMethod: string | null;
  explanation: string[];
  uncertaintyMultiplier: number;
};

type ShippingMethodTemplate = {
  key: string;
  patterns: RegExp[];
  minCostUsd: number | null;
  maxCostUsd: number | null;
  minDays: number | null;
  maxDays: number | null;
  confidence: number;
};

const SHIPPING_METHOD_TEMPLATES: ShippingMethodTemplate[] = [
  {
    key: "CJ_US_WAREHOUSE",
    patterns: [/cj us warehouse/i, /\bus warehouse\b/i, /\bships from us\b/i, /\bship from united states\b/i],
    minCostUsd: 0,
    maxCostUsd: 4.99,
    minDays: 2,
    maxDays: 6,
    confidence: 0.88,
  },
  {
    key: "ALIEXPRESS_STANDARD",
    patterns: [/aliexpress standard shipping/i, /\bstandard shipping\b/i],
    minCostUsd: 3.5,
    maxCostUsd: 7.5,
    minDays: 7,
    maxDays: 12,
    confidence: 0.66,
  },
  {
    key: "CAINIAO",
    patterns: [/cainiao/i],
    minCostUsd: 2.99,
    maxCostUsd: 6.49,
    minDays: 8,
    maxDays: 16,
    confidence: 0.6,
  },
  {
    key: "EPACKET",
    patterns: [/e[- ]?packet/i],
    minCostUsd: 4.49,
    maxCostUsd: 7.99,
    minDays: 7,
    maxDays: 14,
    confidence: 0.64,
  },
  {
    key: "DOLLAR_EXPRESS",
    patterns: [/dollar express/i],
    minCostUsd: 5.99,
    maxCostUsd: 8.99,
    minDays: 5,
    maxDays: 9,
    confidence: 0.7,
  },
  {
    key: "CHOICE",
    patterns: [/\bchoice\b/i],
    minCostUsd: 0,
    maxCostUsd: 4.99,
    minDays: 5,
    maxDays: 10,
    confidence: 0.72,
  },
  {
    key: "FREE_SHIPPING",
    patterns: [/free shipping/i],
    minCostUsd: 0,
    maxCostUsd: 0,
    minDays: 6,
    maxDays: 15,
    confidence: 0.76,
  },
  {
    key: "EXPRESS_GENERIC",
    patterns: [/\bexpress\b/i, /\bfedex\b/i, /\bdhl\b/i, /\bups\b/i, /\busps\b/i],
    minCostUsd: 6.99,
    maxCostUsd: 11.99,
    minDays: 4,
    maxDays: 9,
    confidence: 0.62,
  },
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, round2(value)));
}

function normalizeScore(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return clamp01(value / max);
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function median(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) return round2(valid[middle]);
  return round2((valid[middle - 1] + valid[middle]) / 2);
}

function detectMethod(methodText: string | null): string | null {
  if (!methodText) return null;
  for (const template of SHIPPING_METHOD_TEMPLATES) {
    if (template.patterns.some((pattern) => pattern.test(methodText))) {
      return template.key;
    }
  }
  return null;
}

function findTemplate(methodKey: string | null): ShippingMethodTemplate | null {
  return methodKey ? SHIPPING_METHOD_TEMPLATES.find((template) => template.key === methodKey) ?? null : null;
}

function buildSignalText(rawPayload: Record<string, unknown>, shippingEstimates: ShippingEstimate[]): string {
  return [
    rawPayload.shippingMethod,
    rawPayload.shippingBadge,
    rawPayload.shippingEvidenceText,
    rawPayload.shippingSignal,
    rawPayload.shipsFromHint,
    rawPayload.shipFromCountry,
    rawPayload.ship_from_country,
    rawPayload.shipFromLocation,
    rawPayload.ship_from_location,
    rawPayload.shippingGuarantee,
    ...shippingEstimates.map((estimate) => estimate.label),
  ]
    .map((value) => compactText(value))
    .filter(Boolean)
    .join(" | ");
}

function deriveSourceQuality(rawPayload: Record<string, unknown>): number {
  const snapshotQuality = compactText(rawPayload.snapshotQuality).toUpperCase();
  const detailQuality = compactText(rawPayload.detailQuality || rawPayload.enrichmentQuality).toUpperCase();
  let score = 0.08;
  if (snapshotQuality === "HIGH") score += 0.12;
  else if (snapshotQuality === "MEDIUM") score += 0.08;
  if (detailQuality === "HIGH") score += 0.1;
  else if (detailQuality === "MEDIUM") score += 0.06;
  if (compactText(rawPayload.evidenceSource).toLowerCase().includes("detail")) score += 0.05;
  return Math.min(0.3, round2(score));
}

function deriveCompletenessScore(input: {
  shippingCostUsd: number | null;
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  originCountry: string | null;
  methodKey: string | null;
}): number {
  let score = 0;
  if (input.shippingCostUsd != null) score += 0.1;
  if (input.estimatedMinDays != null || input.estimatedMaxDays != null) score += 0.07;
  if (input.originCountry) score += 0.05;
  if (input.methodKey) score += 0.05;
  return Math.min(0.27, round2(score));
}

function deriveConsistencyScore(input: {
  methodKey: string | null;
  originCountry: string | null;
  shippingCostUsd: number | null;
  estimatedMaxDays: number | null;
  profile: SupplierShippingProfile | null;
}): number {
  if (!input.profile || input.profile.sampleCount <= 0) return 0.06;
  let score = Math.max(0.06, input.profile.consistencyScore * 0.18);
  if (input.methodKey && input.profile.preferredMethods.includes(input.methodKey)) score += 0.04;
  if (input.originCountry && input.profile.dominantOriginCountry === input.originCountry) score += 0.03;
  if (input.shippingCostUsd != null && input.profile.averageCostUsd != null) {
    const deltaPct = Math.abs(input.shippingCostUsd - input.profile.averageCostUsd) / Math.max(input.profile.averageCostUsd, 1);
    if (deltaPct <= 0.25) score += 0.04;
    else if (deltaPct > 0.6) score -= 0.04;
  }
  if (input.estimatedMaxDays != null && input.profile.averageMaxDays != null) {
    const deltaDays = Math.abs(input.estimatedMaxDays - input.profile.averageMaxDays);
    if (deltaDays <= 4) score += 0.03;
  }
  return Math.max(0, Math.min(0.25, round2(score)));
}

function deriveRecencyScore(): number {
  return 0.18;
}

function inferFromTemplate(input: {
  template: ShippingMethodTemplate | null;
  profile: SupplierShippingProfile | null;
  explicitCostUsd: number | null;
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  originCountry: string | null;
}): {
  shippingCostUsd: number | null;
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  originCountry: string | null;
  baseConfidence: number | null;
} {
  const { template, profile } = input;
  const shippingCostUsd =
    input.explicitCostUsd ??
    median([
      template?.minCostUsd != null && template?.maxCostUsd != null
        ? (template.minCostUsd + template.maxCostUsd) / 2
        : null,
      profile?.averageCostUsd,
    ]);
  return {
    shippingCostUsd,
    estimatedMinDays: input.estimatedMinDays ?? template?.minDays ?? profile?.averageMinDays ?? null,
    estimatedMaxDays: input.estimatedMaxDays ?? template?.maxDays ?? profile?.averageMaxDays ?? null,
    originCountry: input.originCountry ?? profile?.dominantOriginCountry ?? null,
    baseConfidence: template?.confidence ?? (profile?.historicalConfidence != null ? clamp01(profile.historicalConfidence) : null),
  };
}

export function inferShippingFromEvidence(input: {
  supplierKey: string;
  destinationCountry: string;
  shippingEstimates?: unknown;
  rawPayload?: unknown;
  profile?: SupplierShippingProfile | null;
  defaultShippingUsd?: number | null;
}): ShippingInferenceResult {
  const rawPayload = asObject(input.rawPayload) ?? {};
  const shippingEstimates = Array.isArray(input.shippingEstimates)
    ? (input.shippingEstimates as ShippingEstimate[])
    : asObject(input.shippingEstimates)
      ? [input.shippingEstimates as ShippingEstimate]
      : [];
  const signalText = buildSignalText(rawPayload, shippingEstimates);
  const rawSignal = compactText(rawPayload.shippingSignal).toUpperCase() || null;
  const explicitCostUsd = median([
    toNum(rawPayload.shippingPriceExplicit),
    ...shippingEstimates.map((estimate) => toNum(estimate.cost)),
  ]);
  const explicitMinDays = median([
    toNum(rawPayload.deliveryEstimateMinDays),
    ...shippingEstimates.map((estimate) => toNum(estimate.etaMinDays)),
  ]);
  const explicitMaxDays = median([
    toNum(rawPayload.deliveryEstimateMaxDays),
    ...shippingEstimates.map((estimate) => toNum(estimate.etaMaxDays)),
  ]);
  const originCountry =
    normalizeShipFromCountry(rawPayload.shipFromCountry) ??
    normalizeShipFromCountry(rawPayload.ship_from_country) ??
    normalizeShipFromCountry(rawPayload.supplierWarehouseCountry) ??
    normalizeShipFromCountry(rawPayload.supplier_warehouse_country) ??
    normalizeShipFromCountry(rawPayload.shipFromLocation) ??
    normalizeShipFromCountry(rawPayload.ship_from_location) ??
    shippingEstimates
      .map((estimate) => normalizeShipFromCountry(estimate.ship_from_country ?? estimate.ship_from_location))
      .find(Boolean) ??
    null;
  const methodKey = detectMethod(signalText || null);
  const template = findTemplate(methodKey);
  const derived = inferFromTemplate({
    template,
    profile: input.profile ?? null,
    explicitCostUsd,
    estimatedMinDays: explicitMinDays,
    estimatedMaxDays: explicitMaxDays,
    originCountry,
  });
  const completenessScore = deriveCompletenessScore({
    shippingCostUsd: derived.shippingCostUsd,
    estimatedMinDays: derived.estimatedMinDays,
    estimatedMaxDays: derived.estimatedMaxDays,
    originCountry: derived.originCountry,
    methodKey,
  });
  const sourceQualityScore = deriveSourceQuality(rawPayload);
  const consistencyScore = deriveConsistencyScore({
    methodKey,
    originCountry: derived.originCountry,
    shippingCostUsd: derived.shippingCostUsd,
    estimatedMaxDays: derived.estimatedMaxDays,
    profile: input.profile ?? null,
  });
  const recencyScore = deriveRecencyScore();
  const normalizedSourceQuality = normalizeScore(sourceQualityScore, 0.3);
  const normalizedCompleteness = normalizeScore(completenessScore, 0.27);
  const normalizedConsistency = normalizeScore(consistencyScore, 0.25);
  const normalizedRecency = normalizeScore(recencyScore, 0.18);
  const totalConfidence = clamp01(
    (derived.baseConfidence ?? 0.2) * 0.45 +
      normalizedSourceQuality * 0.15 +
      normalizedCompleteness * 0.15 +
      normalizedConsistency * 0.15 +
      normalizedRecency * 0.1
  );
  const strongEvidence =
    explicitCostUsd != null ||
    methodKey != null ||
    rawSignal === "DIRECT" ||
    rawSignal === "PRESENT" ||
    rawSignal === "PARTIAL" ||
    rawSignal === "INFERRED";
  const strongProfile = Boolean(input.profile?.sampleCount && input.profile.sampleCount >= 4 && normalizedConsistency >= 0.55);
  const explanation = [
    methodKey ? `method=${methodKey}` : null,
    derived.originCountry ? `origin=${derived.originCountry}` : null,
    derived.shippingCostUsd != null ? `cost=${round2(derived.shippingCostUsd)}` : null,
    derived.estimatedMaxDays != null ? `delivery_max=${derived.estimatedMaxDays}` : null,
    input.profile?.sampleCount ? `profile_samples=${input.profile.sampleCount}` : null,
    rawSignal ? `signal=${rawSignal}` : null,
  ].filter((value): value is string => Boolean(value));

  if (derived.shippingCostUsd == null) {
    return {
      mode: "UNRESOLVED",
      shippingCostUsd: null,
      estimatedMinDays: derived.estimatedMinDays,
      estimatedMaxDays: derived.estimatedMaxDays,
      originCountry: derived.originCountry,
      confidence: null,
      sourceType: "shipping_unresolved",
      shippingMethod: methodKey,
      explanation,
      uncertaintyMultiplier: 1.7,
    };
  }

  if (totalConfidence >= 0.72 && (strongEvidence || strongProfile)) {
    return {
      mode: "INFERRED_STRONG",
      shippingCostUsd: round2(derived.shippingCostUsd),
      estimatedMinDays: derived.estimatedMinDays,
      estimatedMaxDays: derived.estimatedMaxDays,
      originCountry: derived.originCountry,
      confidence: totalConfidence,
      sourceType: "shipping_inferred_strong",
      shippingMethod: methodKey,
      explanation,
      uncertaintyMultiplier: 1.2,
    };
  }

  if (strongEvidence && totalConfidence >= 0.58) {
    return {
      mode: "INFERRED_STRONG",
      shippingCostUsd: round2(derived.shippingCostUsd),
      estimatedMinDays: derived.estimatedMinDays,
      estimatedMaxDays: derived.estimatedMaxDays,
      originCountry: derived.originCountry,
      confidence: totalConfidence,
      sourceType: "shipping_inferred_strong",
      shippingMethod: methodKey,
      explanation,
      uncertaintyMultiplier: 1.25,
    };
  }

  if (input.profile?.sampleCount && totalConfidence >= 0.38) {
    return {
      mode: "INFERRED_WEAK",
      shippingCostUsd: round2(derived.shippingCostUsd),
      estimatedMinDays: derived.estimatedMinDays,
      estimatedMaxDays: derived.estimatedMaxDays,
      originCountry: derived.originCountry,
      confidence: Math.min(totalConfidence, 0.57),
      sourceType: "shipping_inferred_weak",
      shippingMethod: methodKey,
      explanation,
      uncertaintyMultiplier: 1.4,
    };
  }

  if (input.defaultShippingUsd != null) {
    return {
      mode: "FALLBACK_DEFAULT",
      shippingCostUsd: round2(input.defaultShippingUsd),
      estimatedMinDays: derived.estimatedMinDays,
      estimatedMaxDays: derived.estimatedMaxDays,
      originCountry: derived.originCountry,
      confidence: 0.2,
      sourceType: "shipping_fallback_default",
      shippingMethod: methodKey,
      explanation,
      uncertaintyMultiplier: 1.5,
    };
  }

  return {
    mode: "UNRESOLVED",
    shippingCostUsd: null,
    estimatedMinDays: derived.estimatedMinDays,
    estimatedMaxDays: derived.estimatedMaxDays,
    originCountry: derived.originCountry,
    confidence: totalConfidence,
    sourceType: "shipping_unresolved",
    shippingMethod: methodKey,
    explanation,
    uncertaintyMultiplier: 1.7,
  };
}

export function summarizeShippingConfidence(value: number | null): "HIGH" | "MEDIUM" | "LOW" {
  if (value != null && value >= 0.75) return "HIGH";
  if (value != null && value >= 0.45) return "MEDIUM";
  return "LOW";
}
