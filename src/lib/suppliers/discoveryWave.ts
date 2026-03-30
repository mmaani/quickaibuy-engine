import {
  canonicalSupplierKey,
  getDefaultSupplierWaveBudgets,
  type SupplierIntelligenceSignal,
  type SupplierWaveBudget,
} from "@/lib/suppliers/intelligence";

export type DiscoveryWaveLearningAdjustment = {
  supplierReliability: number;
  shippingReliability: number;
  stockReliability: number;
  parserYield: number;
  publishability: number;
  failurePressure: number;
};

export type DiscoveryOpportunityTier =
  | "US_ORIGIN_STRONG"
  | "KNOWN_NON_US_ORIGIN"
  | "ORIGIN_UNRESOLVED";

export type DiscoveryWaveSourcePlan = {
  source: string;
  searchLimit: number;
  maximumPersistShare: number;
  targetPersistFloorShare: number;
  minimumReliabilityScore: number;
  requireKnownOriginForUs: boolean;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function getDiscoveryOpportunityTier(signal: SupplierIntelligenceSignal): DiscoveryOpportunityTier {
  if (signal.destinationCountry === "US" && signal.hasUsWarehouse) return "US_ORIGIN_STRONG";
  if (signal.hasStrongOriginEvidence) return "KNOWN_NON_US_ORIGIN";
  return "ORIGIN_UNRESOLVED";
}

export function computeDiscoverySourceStrength(input: {
  budget: SupplierWaveBudget;
  learning?: DiscoveryWaveLearningAdjustment | null;
  comboBoost?: number | null;
}): number {
  const learning = input.learning ?? null;
  const comboBoost = clamp01(input.comboBoost ?? 0.5);
  return clamp01(
    0.28 +
      input.budget.searchMultiplier * 0.08 +
      (learning?.supplierReliability ?? 0.5) * 0.22 +
      (learning?.shippingReliability ?? 0.5) * 0.16 +
      (learning?.parserYield ?? 0.5) * 0.14 +
      (learning?.publishability ?? 0.5) * 0.16 +
      comboBoost * 0.12 -
      (learning?.failurePressure ?? 0) * 0.24
  );
}

export function buildDiscoveryWaveSourcePlan(input: {
  limitPerKeyword: number;
  learningAdjustments?: Map<string, DiscoveryWaveLearningAdjustment>;
  comboBoosts?: Record<string, number>;
}): DiscoveryWaveSourcePlan[] {
  return getDefaultSupplierWaveBudgets().map((budget) => {
    const source = canonicalSupplierKey(budget.supplierKey);
    const sourceStrength = computeDiscoverySourceStrength({
      budget,
      learning: input.learningAdjustments?.get(source) ?? null,
      comboBoost: input.comboBoosts?.[`${source}:ebay`] ?? 0.5,
    });
    return {
      source,
      searchLimit: Math.max(
        budget.minimumSearchLimit,
        Math.round(Math.max(1, input.limitPerKeyword) * budget.searchMultiplier * Math.max(0.45, sourceStrength))
      ),
      maximumPersistShare: budget.maximumPersistShare,
      targetPersistFloorShare: budget.targetPersistFloorShare,
      minimumReliabilityScore: budget.minimumReliabilityScore,
      requireKnownOriginForUs: budget.requireKnownOriginForUs,
    };
  });
}

export function computeDiscoveryPersistPriority(input: {
  signal: SupplierIntelligenceSignal;
  budget: SupplierWaveBudget;
  learnedReliability: number;
  learning?: DiscoveryWaveLearningAdjustment | null;
  keywordScore: number;
}): number {
  const tier = getDiscoveryOpportunityTier(input.signal);
  const tierBoost = tier === "US_ORIGIN_STRONG" ? 0.34 : tier === "KNOWN_NON_US_ORIGIN" ? 0.2 : -0.38;
  return clamp01(
    input.signal.reliabilityScore * 0.34 +
      input.learnedReliability * 0.18 +
      input.signal.originAvailabilityRate * 0.16 +
      input.signal.shippingTransparencyRate * 0.1 +
      input.signal.shippingEvidenceStrength * 0.06 +
      input.signal.stockEvidenceStrength * 0.04 +
      clamp01(input.keywordScore) * 0.08 +
      (input.learning?.parserYield ?? 0.5) * 0.05 +
      (input.learning?.publishability ?? 0.5) * 0.05 -
      (input.learning?.failurePressure ?? 0) * 0.08 +
      tierBoost
  );
}

export function computeSourcePersistCap(input: {
  budget: SupplierWaveBudget;
  sourceKey: string;
  totalPersistable: number;
  strongAlternativeSourceCount: number;
}): number {
  const normalizedSource = canonicalSupplierKey(input.sourceKey);
  const baselineCap = Math.max(1, Math.floor(Math.max(1, input.totalPersistable) * input.budget.maximumPersistShare));
  if (normalizedSource === "aliexpress" && input.strongAlternativeSourceCount > 0) {
    return Math.min(baselineCap, 1);
  }
  return baselineCap;
}
