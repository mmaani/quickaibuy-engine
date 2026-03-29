import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  canonicalSupplierKey,
  computeShippingEvidenceStrength,
  computeStockEvidenceStrength,
  supplierBasePriorityScore,
} from "@/lib/suppliers/intelligence";

type RawIntelligenceRow = {
  candidateId: string;
  supplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  calcTs: string | Date | null;
  estimatedProfit: unknown;
  marginPct: unknown;
  roiPct: unknown;
  riskFlags: string[] | null;
  decisionStatus: string | null;
  candidateReason: string | null;
  listingEligible: boolean | null;
  listingBlockReason: string | null;
  supplierTitle: string | null;
  supplierImages: unknown;
  supplierAvailabilityStatus: string | null;
  supplierShippingEstimates: unknown;
  supplierRawPayload: unknown;
  supplierSnapshotTs: string | Date | null;
  marketplaceTitle: string | null;
  marketplaceRawPayload: unknown;
  marketplaceMatchScore: unknown;
  marketplaceSnapshotTs: string | Date | null;
  matchConfidence: unknown;
  matchStatus: string | null;
  matchEvidence: unknown;
  listingId: string | null;
  listingStatus: string | null;
  listingTitle: string | null;
  listingPayload: unknown;
  listingResponse: unknown;
  listingUpdatedAt: string | Date | null;
  publishedExternalId: string | null;
  orderCount: unknown;
};

type SupplierFeatureRow = {
  supplierKey: string;
  supplierReliability: unknown;
  shippingReliability: unknown;
  stockReliability: unknown;
  publishability: unknown;
  failurePressure: unknown;
};

export type ProductTaxonomy = {
  normalizedTitle: string;
  productConceptKey: string;
  productConceptLabel: string;
  categoryKey: string;
  categoryLabel: string;
  useCaseKey: string;
  useCaseLabel: string;
  profileKey: string;
  profileLabel: string;
};

export type OpportunityExplanation = {
  positives: string[];
  negatives: string[];
};

export type OpportunityScoreBreakdown = {
  score: number;
  supplierReliability: number;
  stockEvidenceStrength: number;
  shippingEvidenceStrength: number;
  categoryQuality: number;
  productProfileQuality: number;
  marketplaceFitQuality: number;
  matchConfidence: number;
  attributeCompleteness: number;
  profitQuality: number;
  publishabilityScore: number;
  failurePressure: number;
  driftPressure: number;
  explanation: OpportunityExplanation;
};

export type ProductKnowledgeNode = {
  candidateId: string;
  supplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  taxonomy: ProductTaxonomy;
  normalizedTitle: string;
  supplierMix: string[];
  marketplaceMix: string[];
  attributeCompleteness: number;
  imageMediaQuality: number;
  stockEvidenceQuality: number;
  shippingEvidenceQuality: number;
  matchConfidence: number;
  profitOutcome: {
    estimatedProfit: number | null;
    marginPct: number | null;
    roiPct: number | null;
    profitQuality: number;
  };
  publishOutcome: {
    decisionStatus: string | null;
    listingStatus: string | null;
    listingEligible: boolean;
    publishSuccess: boolean;
  };
  marketOutcome: {
    orderCount: number;
    impressions: number | null;
    clicks: number | null;
    clickThroughRate: number | null;
  };
  supplierReliability: number;
  parserVersion: string | null;
  freshnessHours: number | null;
  blockedReasons: string[];
  opportunity: OpportunityScoreBreakdown;
};

export type CategoryIntelligenceRow = {
  key: string;
  label: string;
  productCount: number;
  publishableRatio: number;
  manualReviewRatio: number;
  blockedRatio: number;
  weakSupplierEvidenceRatio: number;
  supplierDiversity: number;
  shippingKnownRatio: number;
  stockKnownRatio: number;
  publishSuccessRatio: number;
  supplierReliability: number;
  topBlockedReasons: Array<{ reason: string; count: number }>;
  opportunityScore: number;
  recommendation: "prioritize" | "deprioritize" | "pause" | "watch";
};

export type ProductProfileIntelligenceRow = {
  key: string;
  label: string;
  categoryKey: string;
  supplierAvailabilityQuality: number;
  shippingQuality: number;
  priceCompetitiveness: number;
  matchQuality: number;
  publishability: number;
  performanceScore: number;
  productCount: number;
  filteredEarlyRatio: number;
  opportunityScore: number;
  recommendation: "best_now" | "weak_now" | "needs_better_suppliers" | "filter_early";
};

export type SupplierMarketplaceComboRow = {
  supplierKey: string;
  marketplaceKey: string;
  categoryCount: number;
  productCount: number;
  publishableRatio: number;
  publishSuccessRatio: number;
  opportunityScore: number;
};

export type MarketplaceFitRow = {
  marketplaceKey: string;
  categoryKey: string;
  categoryLabel: string;
  productCount: number;
  categorySuccessRatio: number;
  itemSpecificCompleteness: number;
  shippingTransparencyRatio: number;
  shipFromNormalizationRatio: number;
  publishSuccessRatio: number;
  policySensitiveRatio: number;
  topFailureSignatures: Array<{ reason: string; count: number }>;
  fitScore: number;
};

export type AttributeIntelligenceRow = {
  categoryKey: string;
  categoryLabel: string;
  profileKey: string;
  profileLabel: string;
  attributeKey: string;
  coverageRatio: number;
  publishSuccessWhenPresent: number;
  publishSuccessWhenMissing: number;
  missingFailureRate: number;
  priority: "required" | "high_value" | "optional" | "noise";
};

export type ProductMarketRecommendation = {
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
};

type AttributePriority = AttributeIntelligenceRow["priority"];

export type ProductMarketIntelligenceOverview = {
  generatedAt: string;
  windowDays: number;
  knowledgeGraph: {
    productCount: number;
    categories: number;
    profiles: number;
    supplierMarketplaceCombos: number;
    nodes: ProductKnowledgeNode[];
  };
  categoryIntelligence: {
    strongest: CategoryIntelligenceRow[];
    weakest: CategoryIntelligenceRow[];
  };
  productProfileIntelligence: {
    strongest: ProductProfileIntelligenceRow[];
    weakest: ProductProfileIntelligenceRow[];
  };
  marketplaceFitIntelligence: MarketplaceFitRow[];
  attributeIntelligence: AttributeIntelligenceRow[];
  supplierMarketplaceIntelligence: SupplierMarketplaceComboRow[];
  opportunities: ProductKnowledgeNode[];
  recommendations: ProductMarketRecommendation[];
  discoveryHints: {
    prioritizedCategoryKeys: string[];
    pausedCategoryKeys: string[];
    prioritizedProfileKeys: string[];
    filteredProfileKeys: string[];
    supplierBoostByMarketplace: Record<string, number>;
  };
};

type CategoryAccumulator = {
  key: string;
  label: string;
  productCount: number;
  publishableCount: number;
  manualReviewCount: number;
  blockedCount: number;
  weakSupplierEvidenceCount: number;
  shippingKnownCount: number;
  stockKnownCount: number;
  publishSuccessCount: number;
  supplierReliabilitySum: number;
  suppliers: Set<string>;
  blockedReasons: Map<string, number>;
};

type ProfileAccumulator = {
  key: string;
  label: string;
  categoryKey: string;
  productCount: number;
  supplierAvailabilityQualitySum: number;
  shippingQualitySum: number;
  priceCompetitivenessSum: number;
  matchQualitySum: number;
  publishabilitySum: number;
  performanceSum: number;
  filteredEarlyCount: number;
};

type MarketplaceFitAccumulator = {
  marketplaceKey: string;
  categoryKey: string;
  categoryLabel: string;
  productCount: number;
  successCount: number;
  itemSpecificCompletenessSum: number;
  shippingTransparencyCount: number;
  shipFromNormalizationCount: number;
  publishSuccessCount: number;
  policySensitiveCount: number;
  failureSignatures: Map<string, number>;
};

type ComboAccumulator = {
  supplierKey: string;
  marketplaceKey: string;
  productCount: number;
  categoryKeys: Set<string>;
  publishableCount: number;
  publishSuccessCount: number;
  scoreSum: number;
};

type AttributeAccumulator = {
  categoryKey: string;
  categoryLabel: string;
  profileKey: string;
  profileLabel: string;
  attributeKey: string;
  presentCount: number;
  missingCount: number;
  successWhenPresent: number;
  successWhenMissing: number;
  failureWhenMissing: number;
};

type DerivedNodeDraft = Omit<ProductKnowledgeNode, "opportunity"> & {
  itemSpecifics: Record<string, string | null>;
  shipFromKnown: boolean;
  priceCompetitiveness: number;
  policySensitive: boolean;
  failurePressure: number;
  driftPressure: number;
  publishabilityScore: number;
};

const PROFILE_RULES = [
  {
    profileKey: "night-light",
    profileLabel: "Night Light",
    categoryKey: "lighting-decor",
    categoryLabel: "Lighting & Decor",
    useCaseKey: "ambient-home-lighting",
    useCaseLabel: "Ambient Home Lighting",
    keywords: ["night light", "bedside", "ambient lamp", "acrylic lamp", "crystal lamp", "led lamp"],
    attributeKeys: ["type", "power source", "material", "color", "features"],
  },
  {
    profileKey: "desk-lamp",
    profileLabel: "Desk Lamp",
    categoryKey: "lighting-decor",
    categoryLabel: "Lighting & Decor",
    useCaseKey: "desk-setup",
    useCaseLabel: "Desk Setup",
    keywords: ["desk lamp", "table lamp", "reading lamp", "lamp"],
    attributeKeys: ["type", "power source", "material", "color", "features"],
  },
  {
    profileKey: "desk-organizer",
    profileLabel: "Desk Organizer",
    categoryKey: "desk-organization",
    categoryLabel: "Desk Organization",
    useCaseKey: "workspace-organization",
    useCaseLabel: "Workspace Organization",
    keywords: ["desk organizer", "pen holder", "storage box", "organizer", "desk caddy"],
    attributeKeys: ["type", "material", "color", "features"],
  },
  {
    profileKey: "car-phone-mount",
    profileLabel: "Car Phone Mount",
    categoryKey: "car-accessories",
    categoryLabel: "Car Accessories",
    useCaseKey: "in-car-device-mounting",
    useCaseLabel: "In-Car Device Mounting",
    keywords: ["car phone mount", "magnetic mount", "car mount", "phone holder", "dashboard mount"],
    attributeKeys: ["mounting location", "compatible brand", "features", "material", "color"],
  },
  {
    profileKey: "portable-fan",
    profileLabel: "Portable Fan",
    categoryKey: "portable-comfort",
    categoryLabel: "Portable Comfort",
    useCaseKey: "portable-cooling",
    useCaseLabel: "Portable Cooling",
    keywords: ["portable fan", "mini fan", "desk fan", "handheld fan"],
    attributeKeys: ["power source", "features", "material", "color", "type"],
  },
  {
    profileKey: "home-decor-gift",
    profileLabel: "Home Decor Gift",
    categoryKey: "home-decor-gifts",
    categoryLabel: "Home Decor Gifts",
    useCaseKey: "giftable-home-decor",
    useCaseLabel: "Giftable Home Decor",
    keywords: ["home decor", "decor gift", "gift decor", "ornament", "decor"],
    attributeKeys: ["theme", "material", "color", "features", "type"],
  },
];

function clamp01(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactKey(value: string): string {
  return value.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compareDesc(left: number, right: number): number {
  return right - left;
}

function toDate(value: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getFreshnessHours(...values: Array<string | Date | null>): number | null {
  const dates = values.map(toDate).filter((value): value is Date => value != null);
  if (!dates.length) return null;
  const latest = dates.sort((left, right) => right.getTime() - left.getTime())[0];
  return Math.max(0, (Date.now() - latest.getTime()) / 36e5);
}

function extractListingPerformance(response: unknown): {
  impressions: number | null;
  clicks: number | null;
  clickThroughRate: number | null;
} {
  const responseRecord = asObject(response);
  const listingPerformance = asObject(responseRecord?.listingPerformance);
  const readiness = asObject(listingPerformance?.readiness);
  const impressions = toNullableNumber(
    listingPerformance?.impressions ?? listingPerformance?.views ?? readiness?.impressions
  );
  const clicks = toNullableNumber(listingPerformance?.clicks ?? readiness?.clicks);
  const clickThroughRate =
    impressions != null && impressions > 0 && clicks != null
      ? clamp01(clicks / impressions)
      : toNullableNumber(listingPerformance?.clickThroughRate ?? readiness?.clickThroughRate);
  return { impressions, clicks, clickThroughRate };
}

function extractItemSpecifics(
  listingPayload: unknown,
  listingResponse: unknown,
  marketplaceRawPayload: unknown
): Record<string, string | null> {
  const payload = asObject(listingPayload);
  const response = asObject(listingResponse);
  const aiListing = asObject(response?.aiListing);
  const verifiedPack = asObject(aiListing?.verifiedPack);
  const raw = asObject(marketplaceRawPayload);
  const sources = [
    asObject(payload?.itemSpecifics),
    asObject(verifiedPack?.verified_item_specifics),
    asObject(raw?.itemSpecifics),
    asObject(raw?.aspects),
  ];
  const specifics: Record<string, string | null> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (!key) continue;
      specifics[key.toLowerCase()] = asString(Array.isArray(value) ? value[0] : value);
    }
  }
  return specifics;
}

function extractCategoryName(listingPayload: unknown, marketplaceRawPayload: unknown): string | null {
  const payload = asObject(listingPayload);
  const raw = asObject(marketplaceRawPayload);
  return (
    asString(payload?.categoryName) ??
    asString(raw?.categoryName) ??
    asString(raw?.leafCategoryName) ??
    asString(raw?.category_path)
  );
}

function extractParserVersion(supplierRawPayload: unknown): string | null {
  const raw = asObject(supplierRawPayload);
  return asString(raw?.parserVersion) ?? asString(raw?.parser_version);
}

function extractShipFromKnown(supplierRawPayload: unknown): boolean {
  const raw = asObject(supplierRawPayload);
  const shipping = asObject(raw?.shipping);
  const estimates = Array.isArray(raw?.shippingEstimates)
    ? raw.shippingEstimates
    : Array.isArray(raw?.shipping_estimates)
      ? raw.shipping_estimates
      : [];
  const estimateShipFrom = estimates
    .map((entry) => asObject(entry))
    .find((entry) => entry && asString(entry.ship_from_country))?.ship_from_country;
  return Boolean(
    asString(raw?.shipFromCountry) ??
      asString(raw?.ship_from_country) ??
      asString(shipping?.ship_from_country) ??
      asString(estimateShipFrom)
  );
}

function buildBlockedReasons(row: RawIntelligenceRow): string[] {
  const reasons = new Set<string>();
  for (const flag of row.riskFlags ?? []) {
    if (flag) reasons.add(String(flag));
  }
  if (row.listingBlockReason) reasons.add(row.listingBlockReason);
  if (row.candidateReason) reasons.add(row.candidateReason);
  return Array.from(reasons);
}

function deriveProductTaxonomy(input: {
  supplierTitle?: string | null;
  marketplaceTitle?: string | null;
  listingTitle?: string | null;
  categoryName?: string | null;
}): ProductTaxonomy {
  const normalizedTitle = normalizeText(
    input.listingTitle,
    input.marketplaceTitle,
    input.supplierTitle,
    input.categoryName
  );
  let bestRule = PROFILE_RULES[PROFILE_RULES.length - 1];
  let bestScore = -1;
  for (const rule of PROFILE_RULES) {
    const score = rule.keywords.filter((keyword) => normalizedTitle.includes(keyword)).length;
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  const conceptSource =
    normalizeText(input.marketplaceTitle, input.supplierTitle, input.listingTitle)
      .split(" ")
      .filter((token) => token.length >= 3)
      .slice(0, 6)
      .join(" ") || bestRule.profileLabel.toLowerCase();

  return {
    normalizedTitle,
    productConceptKey: compactKey(conceptSource),
    productConceptLabel: titleCase(conceptSource),
    categoryKey: bestRule.categoryKey,
    categoryLabel: bestRule.categoryLabel,
    useCaseKey: bestRule.useCaseKey,
    useCaseLabel: bestRule.useCaseLabel,
    profileKey: bestRule.profileKey,
    profileLabel: bestRule.profileLabel,
  };
}

function getExpectedAttributeKeys(profileKey: string): string[] {
  return PROFILE_RULES.find((rule) => rule.profileKey === profileKey)?.attributeKeys ?? ["type", "material", "color"];
}

function computeAttributeCompleteness(profileKey: string, specifics: Record<string, string | null>): number {
  const expected = getExpectedAttributeKeys(profileKey);
  const present = expected.filter((key) => specifics[key] != null).length;
  const fallbackPresent = Object.values(specifics).filter(Boolean).length;
  const denominator = Math.max(expected.length, 3);
  return clamp01(Math.max(present / denominator, fallbackPresent / Math.max(denominator, 5)));
}

function computeImageMediaQuality(images: unknown, supplierRawPayload: unknown): number {
  const count = Array.isArray(images) ? images.length : 0;
  const raw = asObject(supplierRawPayload);
  const snapshotQuality = String(raw?.snapshotQuality ?? "").toUpperCase();
  let score = count >= 6 ? 0.92 : count >= 4 ? 0.78 : count >= 2 ? 0.6 : 0.35;
  if (snapshotQuality === "HIGH") score += 0.06;
  if (snapshotQuality === "LOW" || snapshotQuality === "STUB") score -= 0.12;
  if (Array.isArray(raw?.telemetrySignals)) {
    const telemetry = new Set(raw.telemetrySignals.map((value) => String(value).toLowerCase()));
    if (telemetry.has("low_quality")) score -= 0.12;
    if (telemetry.has("fallback") || telemetry.has("challenge")) score -= 0.16;
  }
  return clamp01(score);
}

function computeProfitQuality(input: {
  estimatedProfit: number | null;
  marginPct: number | null;
  roiPct: number | null;
}): number {
  const profit = input.estimatedProfit == null ? 0 : Math.max(0, Math.min(20, input.estimatedProfit)) / 20;
  const margin = input.marginPct == null ? 0 : Math.max(0, Math.min(80, input.marginPct)) / 80;
  const roi = input.roiPct == null ? 0 : Math.max(0, Math.min(200, input.roiPct)) / 200;
  return clamp01(profit * 0.35 + margin * 0.3 + roi * 0.35);
}

function computePriceCompetitiveness(
  estimatedProfit: number | null,
  marginPct: number | null,
  roiPct: number | null
): number {
  return clamp01((computeProfitQuality({ estimatedProfit, marginPct, roiPct }) * 0.8) + (estimatedProfit != null && estimatedProfit > 0 ? 0.1 : 0));
}

function computePublishability(input: {
  decisionStatus: string | null;
  listingEligible: boolean;
  listingStatus: string | null;
  blockedReasons: string[];
}): number {
  const listingStatus = String(input.listingStatus ?? "").toUpperCase();
  const decisionStatus = String(input.decisionStatus ?? "").toUpperCase();
  let score =
    listingStatus === "ACTIVE"
      ? 0.98
      : listingStatus === "READY_TO_PUBLISH"
        ? 0.9
        : input.listingEligible || decisionStatus === "APPROVED"
          ? 0.78
          : decisionStatus === "MANUAL_REVIEW"
            ? 0.44
            : 0.22;
  if (input.blockedReasons.length > 0) score -= Math.min(0.22, input.blockedReasons.length * 0.04);
  return clamp01(score);
}

function computeFailurePressure(input: {
  blockedReasons: string[];
  decisionStatus: string | null;
  listingStatus: string | null;
  shippingEvidence: number;
  stockEvidence: number;
}): number {
  const decisionStatus = String(input.decisionStatus ?? "").toUpperCase();
  const listingStatus = String(input.listingStatus ?? "").toUpperCase();
  let score = Math.min(0.7, input.blockedReasons.length * 0.12);
  if (decisionStatus === "MANUAL_REVIEW") score += 0.16;
  if (listingStatus === "PUBLISH_FAILED") score += 0.24;
  if (input.shippingEvidence < 0.55) score += 0.16;
  if (input.stockEvidence < 0.55) score += 0.12;
  return clamp01(score);
}

function computeDriftPressure(freshnessHours: number | null): number {
  if (freshnessHours == null) return 0.2;
  if (freshnessHours <= 24) return 0.04;
  if (freshnessHours <= 72) return 0.18;
  if (freshnessHours <= 168) return 0.42;
  return 0.72;
}

export function computeOpportunityScore(input: {
  supplierReliability: number;
  stockEvidenceStrength: number;
  shippingEvidenceStrength: number;
  categoryQuality: number;
  productProfileQuality: number;
  marketplaceFitQuality: number;
  matchConfidence: number;
  attributeCompleteness: number;
  profitQuality: number;
  publishabilityScore: number;
  failurePressure: number;
  driftPressure: number;
}): OpportunityScoreBreakdown {
  const score = clamp01(
    input.supplierReliability * 0.14 +
      input.stockEvidenceStrength * 0.08 +
      input.shippingEvidenceStrength * 0.1 +
      input.categoryQuality * 0.1 +
      input.productProfileQuality * 0.1 +
      input.marketplaceFitQuality * 0.1 +
      input.matchConfidence * 0.08 +
      input.attributeCompleteness * 0.08 +
      input.profitQuality * 0.08 +
      input.publishabilityScore * 0.14 -
      input.failurePressure * 0.08 -
      input.driftPressure * 0.06
  );

  const positives: string[] = [];
  const negatives: string[] = [];

  if (input.publishabilityScore >= 0.75) positives.push("strong publishability evidence");
  if (input.categoryQuality >= 0.7) positives.push("category is publishing cleanly");
  if (input.productProfileQuality >= 0.7) positives.push("profile is performing well");
  if (input.shippingEvidenceStrength >= 0.7) positives.push("shipping evidence is strong");
  if (input.stockEvidenceStrength >= 0.7) positives.push("stock evidence is strong");
  if (input.attributeCompleteness >= 0.7) positives.push("listing attributes are complete");
  if (input.profitQuality >= 0.7) positives.push("profit quality clears preferred range");

  if (input.failurePressure >= 0.45) negatives.push("failure pressure is elevated");
  if (input.driftPressure >= 0.45) negatives.push("freshness/drift pressure is elevated");
  if (input.marketplaceFitQuality < 0.45) negatives.push("marketplace fit is weak");
  if (input.matchConfidence < 0.7) negatives.push("match confidence is weak");
  if (input.shippingEvidenceStrength < 0.55) negatives.push("shipping evidence is weak");
  if (input.stockEvidenceStrength < 0.55) negatives.push("stock evidence is weak");
  if (input.attributeCompleteness < 0.45) negatives.push("important attributes are missing");

  return {
    score,
    supplierReliability: input.supplierReliability,
    stockEvidenceStrength: input.stockEvidenceStrength,
    shippingEvidenceStrength: input.shippingEvidenceStrength,
    categoryQuality: input.categoryQuality,
    productProfileQuality: input.productProfileQuality,
    marketplaceFitQuality: input.marketplaceFitQuality,
    matchConfidence: input.matchConfidence,
    attributeCompleteness: input.attributeCompleteness,
    profitQuality: input.profitQuality,
    publishabilityScore: input.publishabilityScore,
    failurePressure: input.failurePressure,
    driftPressure: input.driftPressure,
    explanation: {
      positives: positives.slice(0, 4),
      negatives: negatives.slice(0, 4),
    },
  };
}

function topCounts(map: Map<string, number>, limit = 3): Array<{ reason: string; count: number }> {
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}

function buildCategoryRecommendation(score: number, publishableRatio: number, blockedRatio: number) {
  if (score >= 0.7 && publishableRatio >= 0.55) return "prioritize" as const;
  if (score < 0.4 || blockedRatio >= 0.55) return "pause" as const;
  if (score < 0.52) return "deprioritize" as const;
  return "watch" as const;
}

function buildProfileRecommendation(score: number, filteredEarlyRatio: number, shippingQuality: number) {
  if (score >= 0.72) return "best_now" as const;
  if (filteredEarlyRatio >= 0.55) return "filter_early" as const;
  if (shippingQuality < 0.48) return "needs_better_suppliers" as const;
  return "weak_now" as const;
}

async function loadRawRows(windowDays: number): Promise<RawIntelligenceRow[]> {
  const result = await db.execute<RawIntelligenceRow>(sql`
    WITH latest_listing AS (
      SELECT DISTINCT ON (l.candidate_id, lower(l.marketplace_key))
        l.id::text AS listing_id,
        l.candidate_id::text AS candidate_id,
        lower(l.marketplace_key) AS marketplace_key,
        l.status AS listing_status,
        l.title AS listing_title,
        l.payload AS listing_payload,
        l.response AS listing_response,
        l.updated_at AS listing_updated_at,
        l.published_external_id AS published_external_id
      FROM listings l
      ORDER BY l.candidate_id, lower(l.marketplace_key), l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
    ),
    latest_match AS (
      SELECT DISTINCT ON (m.supplier_key, m.supplier_product_id, lower(m.marketplace_key), m.marketplace_listing_id)
        m.supplier_key,
        m.supplier_product_id,
        lower(m.marketplace_key) AS marketplace_key,
        m.marketplace_listing_id,
        m.confidence AS match_confidence,
        m.status AS match_status,
        m.evidence AS match_evidence
      FROM matches m
      ORDER BY m.supplier_key, m.supplier_product_id, lower(m.marketplace_key), m.marketplace_listing_id, m.last_seen_ts DESC NULLS LAST, m.first_seen_ts DESC NULLS LAST
    ),
    order_counts AS (
      SELECT
        oi.listing_id::text AS listing_id,
        count(DISTINCT oi.order_id)::int AS order_count
      FROM order_items oi
      WHERE oi.listing_id IS NOT NULL
      GROUP BY 1
    )
    SELECT
      pc.id::text AS "candidateId",
      lower(pc.supplier_key) AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      lower(pc.marketplace_key) AS "marketplaceKey",
      pc.marketplace_listing_id AS "marketplaceListingId",
      pc.calc_ts AS "calcTs",
      pc.estimated_profit AS "estimatedProfit",
      pc.margin_pct AS "marginPct",
      pc.roi_pct AS "roiPct",
      pc.risk_flags AS "riskFlags",
      pc.decision_status AS "decisionStatus",
      pc.reason AS "candidateReason",
      pc.listing_eligible AS "listingEligible",
      pc.listing_block_reason AS "listingBlockReason",
      pr.title AS "supplierTitle",
      pr.images AS "supplierImages",
      pr.availability_status AS "supplierAvailabilityStatus",
      pr.shipping_estimates AS "supplierShippingEstimates",
      pr.raw_payload AS "supplierRawPayload",
      pr.snapshot_ts AS "supplierSnapshotTs",
      mp.matched_title AS "marketplaceTitle",
      mp.raw_payload AS "marketplaceRawPayload",
      mp.final_match_score AS "marketplaceMatchScore",
      mp.snapshot_ts AS "marketplaceSnapshotTs",
      lm.match_confidence AS "matchConfidence",
      lm.match_status AS "matchStatus",
      lm.match_evidence AS "matchEvidence",
      ll.listing_id AS "listingId",
      ll.listing_status AS "listingStatus",
      ll.listing_title AS "listingTitle",
      ll.listing_payload AS "listingPayload",
      ll.listing_response AS "listingResponse",
      ll.listing_updated_at AS "listingUpdatedAt",
      ll.published_external_id AS "publishedExternalId",
      coalesce(oc.order_count, 0)::int AS "orderCount"
    FROM profitable_candidates pc
    JOIN products_raw pr
      ON pr.id = pc.supplier_snapshot_id
    JOIN marketplace_prices mp
      ON mp.id = pc.market_price_snapshot_id
    LEFT JOIN latest_match lm
      ON lower(lm.supplier_key) = lower(pc.supplier_key)
     AND lm.supplier_product_id = pc.supplier_product_id
     AND lm.marketplace_key = lower(pc.marketplace_key)
     AND lm.marketplace_listing_id = pc.marketplace_listing_id
    LEFT JOIN latest_listing ll
      ON ll.candidate_id = pc.id::text
     AND ll.marketplace_key = lower(pc.marketplace_key)
    LEFT JOIN order_counts oc
      ON oc.listing_id = ll.listing_id
    WHERE pc.calc_ts >= now() - make_interval(days => ${windowDays})
    ORDER BY pc.calc_ts DESC NULLS LAST
  `);
  return result.rows ?? [];
}

async function loadSupplierLearning(): Promise<Map<string, SupplierFeatureRow>> {
  const result = await db.execute<SupplierFeatureRow>(sql`
    SELECT
      subject_key AS "supplierKey",
      max(CASE WHEN feature_key = 'supplier_reliability_score' THEN feature_value END) AS "supplierReliability",
      max(CASE WHEN feature_key = 'shipping_reliability_score' THEN feature_value END) AS "shippingReliability",
      max(CASE WHEN feature_key = 'stock_reliability_score' THEN feature_value END) AS "stockReliability",
      max(CASE WHEN feature_key = 'publishability_score' THEN feature_value END) AS "publishability",
      max(CASE WHEN feature_key = 'failure_pressure_score' THEN feature_value END) AS "failurePressure"
    FROM learning_features
    WHERE subject_type = 'supplier'
      AND feature_key IN (
        'supplier_reliability_score',
        'shipping_reliability_score',
        'stock_reliability_score',
        'publishability_score',
        'failure_pressure_score'
      )
    GROUP BY subject_key
  `);
  return new Map(
    (result.rows ?? []).map((row) => [canonicalSupplierKey(row.supplierKey), row])
  );
}

function buildDerivedDrafts(rows: RawIntelligenceRow[], supplierLearning: Map<string, SupplierFeatureRow>) {
  const drafts: DerivedNodeDraft[] = [];
  for (const row of rows) {
    const supplierKey = canonicalSupplierKey(row.supplierKey);
    const taxonomy = deriveProductTaxonomy({
      supplierTitle: row.supplierTitle,
      marketplaceTitle: row.marketplaceTitle,
      listingTitle: row.listingTitle,
      categoryName: extractCategoryName(row.listingPayload, row.marketplaceRawPayload),
    });
    const itemSpecifics = extractItemSpecifics(row.listingPayload, row.listingResponse, row.marketplaceRawPayload);
    const stockEvidence = computeStockEvidenceStrength({
      availabilitySignal: row.supplierAvailabilityStatus,
      rawPayload: row.supplierRawPayload,
    });
    const shippingEvidence = computeShippingEvidenceStrength({
      shippingEstimates: row.supplierShippingEstimates,
      rawPayload: row.supplierRawPayload,
    });
    const supplierFeature = supplierLearning.get(supplierKey);
    const supplierReliability = clamp01(
      (supplierFeature?.supplierReliability != null ? Number(supplierFeature.supplierReliability) : supplierBasePriorityScore(supplierKey)) * 0.55 +
        stockEvidence * 0.2 +
        shippingEvidence * 0.2 +
        (supplierFeature?.publishability != null ? Number(supplierFeature.publishability) : 0.5) * 0.05
    );
    const blockedReasons = buildBlockedReasons(row);
    const listingEligible = Boolean(row.listingEligible);
    const publishSuccess = String(row.listingStatus ?? "").toUpperCase() === "ACTIVE" || Boolean(row.publishedExternalId);
    const performance = extractListingPerformance(row.listingResponse);
    const estimatedProfit = toNullableNumber(row.estimatedProfit);
    const marginPct = toNullableNumber(row.marginPct);
    const roiPct = toNullableNumber(row.roiPct);
    const profitQuality = computeProfitQuality({ estimatedProfit, marginPct, roiPct });
    const priceCompetitiveness = computePriceCompetitiveness(estimatedProfit, marginPct, roiPct);
    const freshnessHours = getFreshnessHours(row.calcTs, row.supplierSnapshotTs, row.marketplaceSnapshotTs, row.listingUpdatedAt);
    const attributeCompleteness = computeAttributeCompleteness(taxonomy.profileKey, itemSpecifics);
    const publishabilityScore = computePublishability({
      decisionStatus: row.decisionStatus,
      listingEligible,
      listingStatus: row.listingStatus,
      blockedReasons,
    });
    const failurePressure = computeFailurePressure({
      blockedReasons,
      decisionStatus: row.decisionStatus,
      listingStatus: row.listingStatus,
      shippingEvidence,
      stockEvidence,
    });
    const driftPressure = computeDriftPressure(freshnessHours);
    const policySensitive = blockedReasons.some((reason) =>
      /brand|policy|category|electronics|manual review/i.test(reason)
    );

    drafts.push({
      candidateId: row.candidateId,
      supplierKey,
      supplierProductId: row.supplierProductId,
      marketplaceKey: row.marketplaceKey,
      marketplaceListingId: row.marketplaceListingId,
      taxonomy,
      normalizedTitle: taxonomy.normalizedTitle,
      supplierMix: [supplierKey],
      marketplaceMix: [row.marketplaceKey],
      attributeCompleteness,
      imageMediaQuality: computeImageMediaQuality(row.supplierImages, row.supplierRawPayload),
      stockEvidenceQuality: stockEvidence,
      shippingEvidenceQuality: shippingEvidence,
      matchConfidence: clamp01(
        toNullableNumber(row.matchConfidence) ?? toNullableNumber(row.marketplaceMatchScore) ?? 0
      ),
      profitOutcome: {
        estimatedProfit,
        marginPct,
        roiPct,
        profitQuality,
      },
      publishOutcome: {
        decisionStatus: row.decisionStatus,
        listingStatus: row.listingStatus,
        listingEligible,
        publishSuccess,
      },
      marketOutcome: {
        orderCount: toCount(row.orderCount),
        impressions: performance.impressions,
        clicks: performance.clicks,
        clickThroughRate: performance.clickThroughRate,
      },
      supplierReliability,
      parserVersion: extractParserVersion(row.supplierRawPayload),
      freshnessHours,
      blockedReasons,
      itemSpecifics,
      shipFromKnown: extractShipFromKnown(row.supplierRawPayload),
      priceCompetitiveness,
      policySensitive,
      failurePressure,
      driftPressure,
      publishabilityScore,
    });
  }
  return drafts;
}

function summarizeCategories(drafts: DerivedNodeDraft[]): CategoryIntelligenceRow[] {
  const map = new Map<string, CategoryAccumulator>();
  for (const draft of drafts) {
    const current =
      map.get(draft.taxonomy.categoryKey) ??
      {
        key: draft.taxonomy.categoryKey,
        label: draft.taxonomy.categoryLabel,
        productCount: 0,
        publishableCount: 0,
        manualReviewCount: 0,
        blockedCount: 0,
        weakSupplierEvidenceCount: 0,
        shippingKnownCount: 0,
        stockKnownCount: 0,
        publishSuccessCount: 0,
        supplierReliabilitySum: 0,
        suppliers: new Set<string>(),
        blockedReasons: new Map<string, number>(),
      };
    current.productCount += 1;
    if (draft.publishOutcome.listingEligible || draft.publishOutcome.decisionStatus === "APPROVED") current.publishableCount += 1;
    if (draft.publishOutcome.decisionStatus === "MANUAL_REVIEW") current.manualReviewCount += 1;
    if (!draft.publishOutcome.listingEligible && draft.blockedReasons.length > 0) current.blockedCount += 1;
    if (draft.supplierReliability < 0.55) current.weakSupplierEvidenceCount += 1;
    if (draft.shippingEvidenceQuality >= 0.6) current.shippingKnownCount += 1;
    if (draft.stockEvidenceQuality >= 0.6) current.stockKnownCount += 1;
    if (draft.publishOutcome.publishSuccess) current.publishSuccessCount += 1;
    current.supplierReliabilitySum += draft.supplierReliability;
    current.suppliers.add(draft.supplierKey);
    for (const reason of draft.blockedReasons) {
      current.blockedReasons.set(reason, (current.blockedReasons.get(reason) ?? 0) + 1);
    }
    map.set(current.key, current);
  }

  return Array.from(map.values()).map((row) => {
    const publishableRatio = row.productCount > 0 ? row.publishableCount / row.productCount : 0;
    const manualReviewRatio = row.productCount > 0 ? row.manualReviewCount / row.productCount : 0;
    const blockedRatio = row.productCount > 0 ? row.blockedCount / row.productCount : 0;
    const weakSupplierEvidenceRatio = row.productCount > 0 ? row.weakSupplierEvidenceCount / row.productCount : 0;
    const supplierDiversity = clamp01(row.suppliers.size / Math.max(2, row.productCount));
    const shippingKnownRatio = row.productCount > 0 ? row.shippingKnownCount / row.productCount : 0;
    const stockKnownRatio = row.productCount > 0 ? row.stockKnownCount / row.productCount : 0;
    const publishSuccessRatio = row.productCount > 0 ? row.publishSuccessCount / row.productCount : 0;
    const supplierReliability = row.productCount > 0 ? row.supplierReliabilitySum / row.productCount : 0;
    const opportunityScore = clamp01(
      publishableRatio * 0.25 +
        publishSuccessRatio * 0.2 +
        shippingKnownRatio * 0.14 +
        stockKnownRatio * 0.14 +
        supplierReliability * 0.14 +
        supplierDiversity * 0.13 -
        manualReviewRatio * 0.12 -
        blockedRatio * 0.16 -
        weakSupplierEvidenceRatio * 0.1
    );

    return {
      key: row.key,
      label: row.label,
      productCount: row.productCount,
      publishableRatio,
      manualReviewRatio,
      blockedRatio,
      weakSupplierEvidenceRatio,
      supplierDiversity,
      shippingKnownRatio,
      stockKnownRatio,
      publishSuccessRatio,
      supplierReliability,
      topBlockedReasons: topCounts(row.blockedReasons),
      opportunityScore,
      recommendation: buildCategoryRecommendation(opportunityScore, publishableRatio, blockedRatio),
    };
  });
}

function summarizeProfiles(drafts: DerivedNodeDraft[]): ProductProfileIntelligenceRow[] {
  const map = new Map<string, ProfileAccumulator>();
  for (const draft of drafts) {
    const current =
      map.get(draft.taxonomy.profileKey) ??
      {
        key: draft.taxonomy.profileKey,
        label: draft.taxonomy.profileLabel,
        categoryKey: draft.taxonomy.categoryKey,
        productCount: 0,
        supplierAvailabilityQualitySum: 0,
        shippingQualitySum: 0,
        priceCompetitivenessSum: 0,
        matchQualitySum: 0,
        publishabilitySum: 0,
        performanceSum: 0,
        filteredEarlyCount: 0,
      };
    current.productCount += 1;
    current.supplierAvailabilityQualitySum += draft.stockEvidenceQuality;
    current.shippingQualitySum += draft.shippingEvidenceQuality;
    current.priceCompetitivenessSum += draft.priceCompetitiveness;
    current.matchQualitySum += draft.matchConfidence;
    current.publishabilitySum += draft.publishabilityScore;
    current.performanceSum += clamp01(
      draft.marketOutcome.orderCount > 0
        ? 1
        : (draft.marketOutcome.clickThroughRate ?? 0) * 0.7 + (draft.marketOutcome.clicks ?? 0) / 25
    );
    if (draft.failurePressure >= 0.45 || (!draft.publishOutcome.listingEligible && draft.blockedReasons.length > 0)) {
      current.filteredEarlyCount += 1;
    }
    map.set(current.key, current);
  }

  return Array.from(map.values()).map((row) => {
    const productCount = Math.max(row.productCount, 1);
    const supplierAvailabilityQuality = row.supplierAvailabilityQualitySum / productCount;
    const shippingQuality = row.shippingQualitySum / productCount;
    const priceCompetitiveness = row.priceCompetitivenessSum / productCount;
    const matchQuality = row.matchQualitySum / productCount;
    const publishability = row.publishabilitySum / productCount;
    const performanceScore = row.performanceSum / productCount;
    const filteredEarlyRatio = row.filteredEarlyCount / productCount;
    const opportunityScore = clamp01(
      supplierAvailabilityQuality * 0.18 +
        shippingQuality * 0.2 +
        priceCompetitiveness * 0.14 +
        matchQuality * 0.14 +
        publishability * 0.2 +
        performanceScore * 0.14 -
        filteredEarlyRatio * 0.2
    );
    return {
      key: row.key,
      label: row.label,
      categoryKey: row.categoryKey,
      supplierAvailabilityQuality,
      shippingQuality,
      priceCompetitiveness,
      matchQuality,
      publishability,
      performanceScore,
      productCount: row.productCount,
      filteredEarlyRatio,
      opportunityScore,
      recommendation: buildProfileRecommendation(opportunityScore, filteredEarlyRatio, shippingQuality),
    };
  });
}

function summarizeMarketplaceFit(drafts: DerivedNodeDraft[]): MarketplaceFitRow[] {
  const map = new Map<string, MarketplaceFitAccumulator>();
  for (const draft of drafts) {
    const key = `${draft.marketplaceKey}:${draft.taxonomy.categoryKey}`;
    const current =
      map.get(key) ??
      {
        marketplaceKey: draft.marketplaceKey,
        categoryKey: draft.taxonomy.categoryKey,
        categoryLabel: draft.taxonomy.categoryLabel,
        productCount: 0,
        successCount: 0,
        itemSpecificCompletenessSum: 0,
        shippingTransparencyCount: 0,
        shipFromNormalizationCount: 0,
        publishSuccessCount: 0,
        policySensitiveCount: 0,
        failureSignatures: new Map<string, number>(),
      };
    current.productCount += 1;
    if (draft.publishOutcome.listingEligible) current.successCount += 1;
    current.itemSpecificCompletenessSum += draft.attributeCompleteness;
    if (draft.shippingEvidenceQuality >= 0.6) current.shippingTransparencyCount += 1;
    if (draft.shipFromKnown) current.shipFromNormalizationCount += 1;
    if (draft.publishOutcome.publishSuccess) current.publishSuccessCount += 1;
    if (draft.policySensitive) current.policySensitiveCount += 1;
    for (const reason of draft.blockedReasons) {
      current.failureSignatures.set(reason, (current.failureSignatures.get(reason) ?? 0) + 1);
    }
    map.set(key, current);
  }

  return Array.from(map.values()).map((row) => {
    const productCount = Math.max(1, row.productCount);
    const categorySuccessRatio = row.successCount / productCount;
    const itemSpecificCompleteness = row.itemSpecificCompletenessSum / productCount;
    const shippingTransparencyRatio = row.shippingTransparencyCount / productCount;
    const shipFromNormalizationRatio = row.shipFromNormalizationCount / productCount;
    const publishSuccessRatio = row.publishSuccessCount / productCount;
    const policySensitiveRatio = row.policySensitiveCount / productCount;
    const fitScore = clamp01(
      categorySuccessRatio * 0.26 +
        itemSpecificCompleteness * 0.18 +
        shippingTransparencyRatio * 0.18 +
        shipFromNormalizationRatio * 0.12 +
        publishSuccessRatio * 0.18 -
        policySensitiveRatio * 0.12
    );
    return {
      marketplaceKey: row.marketplaceKey,
      categoryKey: row.categoryKey,
      categoryLabel: row.categoryLabel,
      productCount: row.productCount,
      categorySuccessRatio,
      itemSpecificCompleteness,
      shippingTransparencyRatio,
      shipFromNormalizationRatio,
      publishSuccessRatio,
      policySensitiveRatio,
      topFailureSignatures: topCounts(row.failureSignatures),
      fitScore,
    };
  });
}

function summarizeAttributes(drafts: DerivedNodeDraft[]): AttributeIntelligenceRow[] {
  const map = new Map<string, AttributeAccumulator>();
  for (const draft of drafts) {
    const keys = new Set([
      ...Object.keys(draft.itemSpecifics),
      ...getExpectedAttributeKeys(draft.taxonomy.profileKey).map((key) => key.toLowerCase()),
    ]);
    const publishSuccess = draft.publishOutcome.publishSuccess || draft.publishOutcome.listingEligible;
    for (const attributeKey of keys) {
      const normalizedKey = attributeKey.toLowerCase();
      const mapKey = `${draft.taxonomy.categoryKey}:${draft.taxonomy.profileKey}:${normalizedKey}`;
      const current =
        map.get(mapKey) ??
        {
          categoryKey: draft.taxonomy.categoryKey,
          categoryLabel: draft.taxonomy.categoryLabel,
          profileKey: draft.taxonomy.profileKey,
          profileLabel: draft.taxonomy.profileLabel,
          attributeKey: normalizedKey,
          presentCount: 0,
          missingCount: 0,
          successWhenPresent: 0,
          successWhenMissing: 0,
          failureWhenMissing: 0,
        };
      const present = draft.itemSpecifics[normalizedKey] != null;
      if (present) {
        current.presentCount += 1;
        if (publishSuccess) current.successWhenPresent += 1;
      } else {
        current.missingCount += 1;
        if (publishSuccess) current.successWhenMissing += 1;
        if (!publishSuccess) current.failureWhenMissing += 1;
      }
      map.set(mapKey, current);
    }
  }

  return Array.from(map.values())
    .map((row) => {
      const presentTotal = Math.max(1, row.presentCount);
      const missingTotal = Math.max(1, row.missingCount);
      const coverageRatio = row.presentCount / Math.max(1, row.presentCount + row.missingCount);
      const publishSuccessWhenPresent = row.successWhenPresent / presentTotal;
      const publishSuccessWhenMissing = row.successWhenMissing / missingTotal;
      const missingFailureRate = row.failureWhenMissing / missingTotal;
      const priority: AttributePriority =
        coverageRatio >= 0.72 || missingFailureRate >= 0.55
          ? "required"
          : publishSuccessWhenPresent - publishSuccessWhenMissing >= 0.18 || coverageRatio >= 0.48
            ? "high_value"
            : coverageRatio >= 0.2
              ? "optional"
              : "noise";
      return {
        categoryKey: row.categoryKey,
        categoryLabel: row.categoryLabel,
        profileKey: row.profileKey,
        profileLabel: row.profileLabel,
        attributeKey: row.attributeKey,
        coverageRatio,
        publishSuccessWhenPresent,
        publishSuccessWhenMissing,
        missingFailureRate,
        priority,
      };
    })
    .sort((left, right) => {
      const priorityRank: Record<AttributePriority, number> = { required: 0, high_value: 1, optional: 2, noise: 3 };
      return (
        priorityRank[left.priority] - priorityRank[right.priority] ||
        compareDesc(left.coverageRatio, right.coverageRatio) ||
        left.attributeKey.localeCompare(right.attributeKey)
      );
    });
}

function summarizeSupplierMarketplace(drafts: DerivedNodeDraft[]): SupplierMarketplaceComboRow[] {
  const map = new Map<string, ComboAccumulator>();
  for (const draft of drafts) {
    const key = `${draft.supplierKey}:${draft.marketplaceKey}`;
    const current =
      map.get(key) ??
      {
        supplierKey: draft.supplierKey,
        marketplaceKey: draft.marketplaceKey,
        productCount: 0,
        categoryKeys: new Set<string>(),
        publishableCount: 0,
        publishSuccessCount: 0,
        scoreSum: 0,
      };
    current.productCount += 1;
    current.categoryKeys.add(draft.taxonomy.categoryKey);
    if (draft.publishOutcome.listingEligible) current.publishableCount += 1;
    if (draft.publishOutcome.publishSuccess) current.publishSuccessCount += 1;
    current.scoreSum += draft.publishabilityScore;
    map.set(key, current);
  }

  return Array.from(map.values()).map((row) => ({
    supplierKey: row.supplierKey,
    marketplaceKey: row.marketplaceKey,
    categoryCount: row.categoryKeys.size,
    productCount: row.productCount,
    publishableRatio: row.productCount > 0 ? row.publishableCount / row.productCount : 0,
    publishSuccessRatio: row.productCount > 0 ? row.publishSuccessCount / row.productCount : 0,
    opportunityScore: row.productCount > 0 ? clamp01(row.scoreSum / row.productCount) : 0,
  }));
}

function finalizeNodes(
  drafts: DerivedNodeDraft[],
  categories: CategoryIntelligenceRow[],
  profiles: ProductProfileIntelligenceRow[],
  marketplaceFit: MarketplaceFitRow[]
): ProductKnowledgeNode[] {
  const categoryMap = new Map(categories.map((row) => [row.key, row]));
  const profileMap = new Map(profiles.map((row) => [row.key, row]));
  const fitMap = new Map(marketplaceFit.map((row) => [`${row.marketplaceKey}:${row.categoryKey}`, row]));

  return drafts.map((draft) => ({
    ...draft,
    opportunity: computeOpportunityScore({
      supplierReliability: draft.supplierReliability,
      stockEvidenceStrength: draft.stockEvidenceQuality,
      shippingEvidenceStrength: draft.shippingEvidenceQuality,
      categoryQuality: categoryMap.get(draft.taxonomy.categoryKey)?.opportunityScore ?? 0.45,
      productProfileQuality: profileMap.get(draft.taxonomy.profileKey)?.opportunityScore ?? 0.45,
      marketplaceFitQuality: fitMap.get(`${draft.marketplaceKey}:${draft.taxonomy.categoryKey}`)?.fitScore ?? 0.45,
      matchConfidence: draft.matchConfidence,
      attributeCompleteness: draft.attributeCompleteness,
      profitQuality: draft.profitOutcome.profitQuality,
      publishabilityScore: draft.publishabilityScore,
      failurePressure: draft.failurePressure,
      driftPressure: draft.driftPressure,
    }),
  }));
}

function buildRecommendations(input: {
  categories: CategoryIntelligenceRow[];
  profiles: ProductProfileIntelligenceRow[];
  combos: SupplierMarketplaceComboRow[];
  attributes: AttributeIntelligenceRow[];
}): ProductMarketRecommendation[] {
  const recommendations: ProductMarketRecommendation[] = [];
  const topCategory = [...input.categories].sort((left, right) => compareDesc(left.opportunityScore, right.opportunityScore))[0];
  const weakCategory = [...input.categories].sort((left, right) => compareDesc(right.opportunityScore, left.opportunityScore))[0];
  const topProfile = [...input.profiles].sort((left, right) => compareDesc(left.opportunityScore, right.opportunityScore))[0];
  const weakProfile = [...input.profiles].sort((left, right) => compareDesc(right.opportunityScore, left.opportunityScore))[0];
  const topCombo = [...input.combos].sort((left, right) => compareDesc(left.opportunityScore, right.opportunityScore))[0];
  const requiredAttributes = input.attributes.filter((row) => row.priority === "required").slice(0, 3);

  if (topCategory) {
    recommendations.push({
      title: `Prioritize ${topCategory.label}`,
      detail: `${topCategory.label} is leading on publishable ratio ${Math.round(topCategory.publishableRatio * 100)}%, shipping-known ${Math.round(topCategory.shippingKnownRatio * 100)}%, and publish success ${Math.round(topCategory.publishSuccessRatio * 100)}%.`,
      severity: "info",
    });
  }

  if (weakCategory && (weakCategory.recommendation === "pause" || weakCategory.recommendation === "deprioritize")) {
    recommendations.push({
      title: `Reduce ${weakCategory.label}`,
      detail: `${weakCategory.label} is carrying blocked ratio ${Math.round(weakCategory.blockedRatio * 100)}% with weak supplier evidence ${Math.round(weakCategory.weakSupplierEvidenceRatio * 100)}%.`,
      severity: weakCategory.recommendation === "pause" ? "critical" : "warning",
    });
  }

  if (topProfile) {
    recommendations.push({
      title: `Expand ${topProfile.label}`,
      detail: `${topProfile.label} is the strongest current profile with publishability ${Math.round(topProfile.publishability * 100)}% and shipping quality ${Math.round(topProfile.shippingQuality * 100)}%.`,
      severity: "info",
    });
  }

  if (weakProfile) {
    recommendations.push({
      title: `Filter weak ${weakProfile.label} rows earlier`,
      detail: `${weakProfile.label} is seeing early-filter ratio ${Math.round(weakProfile.filteredEarlyRatio * 100)}% and opportunity score ${Math.round(weakProfile.opportunityScore * 100)}%.`,
      severity: weakProfile.recommendation === "filter_early" ? "warning" : "info",
    });
  }

  if (topCombo) {
    recommendations.push({
      title: `Bias the next supplier wave toward ${topCombo.supplierKey} on ${topCombo.marketplaceKey}`,
      detail: `${topCombo.supplierKey} has the best marketplace-fit combination with publishable ratio ${Math.round(topCombo.publishableRatio * 100)}% across ${topCombo.categoryCount} active categories.`,
      severity: "info",
    });
  }

  if (requiredAttributes.length > 0) {
    recommendations.push({
      title: "Tighten category-aware attribute completion",
      detail: `Highest leverage specifics right now: ${requiredAttributes.map((row) => `${row.profileLabel}/${row.attributeKey}`).join(", ")}.`,
      severity: "warning",
    });
  }

  return recommendations.slice(0, 6);
}

export function getDiscoveryKeywordAdjustment(
  keyword: string,
  overview: Pick<ProductMarketIntelligenceOverview, "categoryIntelligence" | "productProfileIntelligence">
) {
  const taxonomy = deriveProductTaxonomy({ supplierTitle: keyword });
  const category = overview.categoryIntelligence.strongest.find((row) => row.key === taxonomy.categoryKey)
    ?? overview.categoryIntelligence.weakest.find((row) => row.key === taxonomy.categoryKey);
  const profile = overview.productProfileIntelligence.strongest.find((row) => row.key === taxonomy.profileKey)
    ?? overview.productProfileIntelligence.weakest.find((row) => row.key === taxonomy.profileKey);
  const categoryScore = category?.opportunityScore ?? 0.5;
  const profileScore = profile?.opportunityScore ?? 0.5;
  const shouldFilterEarly =
    category?.recommendation === "pause" ||
    profile?.recommendation === "filter_early" ||
    profile?.recommendation === "weak_now";
  return {
    taxonomy,
    score: clamp01(categoryScore * 0.45 + profileScore * 0.55),
    shouldFilterEarly,
  };
}

export async function getProductMarketIntelligenceOverview(
  options?: { windowDays?: number; includeNodes?: number }
): Promise<ProductMarketIntelligenceOverview> {
  const windowDays = Math.max(14, Math.min(180, options?.windowDays ?? 90));
  const includeNodes = Math.max(10, Math.min(100, options?.includeNodes ?? 30));
  const [rows, supplierLearning] = await Promise.all([loadRawRows(windowDays), loadSupplierLearning()]);
  const drafts = buildDerivedDrafts(rows, supplierLearning);
  const categories = summarizeCategories(drafts);
  const profiles = summarizeProfiles(drafts);
  const marketplaceFit = summarizeMarketplaceFit(drafts);
  const attributes = summarizeAttributes(drafts);
  const combos = summarizeSupplierMarketplace(drafts);
  const nodes = finalizeNodes(drafts, categories, profiles, marketplaceFit).sort((left, right) =>
    compareDesc(left.opportunity.score, right.opportunity.score)
  );
  const strongestCategories = [...categories].sort((left, right) => compareDesc(left.opportunityScore, right.opportunityScore)).slice(0, 6);
  const weakestCategories = [...categories].sort((left, right) => compareDesc(right.opportunityScore, left.opportunityScore)).slice(0, 6);
  const strongestProfiles = [...profiles].sort((left, right) => compareDesc(left.opportunityScore, right.opportunityScore)).slice(0, 6);
  const weakestProfiles = [...profiles].sort((left, right) => compareDesc(right.opportunityScore, left.opportunityScore)).slice(0, 6);
  const sortedCombos = [...combos].sort((left, right) => compareDesc(left.opportunityScore, right.opportunityScore));
  const recommendations = buildRecommendations({
    categories,
    profiles,
    combos: sortedCombos,
    attributes,
  });

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    knowledgeGraph: {
      productCount: nodes.length,
      categories: categories.length,
      profiles: profiles.length,
      supplierMarketplaceCombos: combos.length,
      nodes: nodes.slice(0, includeNodes),
    },
    categoryIntelligence: {
      strongest: strongestCategories,
      weakest: weakestCategories,
    },
    productProfileIntelligence: {
      strongest: strongestProfiles,
      weakest: weakestProfiles,
    },
    marketplaceFitIntelligence: [...marketplaceFit].sort((left, right) => compareDesc(left.fitScore, right.fitScore)).slice(0, 8),
    attributeIntelligence: attributes.slice(0, 24),
    supplierMarketplaceIntelligence: sortedCombos.slice(0, 8),
    opportunities: nodes.slice(0, 12),
    recommendations,
    discoveryHints: {
      prioritizedCategoryKeys: strongestCategories.filter((row) => row.recommendation === "prioritize").map((row) => row.key),
      pausedCategoryKeys: weakestCategories.filter((row) => row.recommendation === "pause").map((row) => row.key),
      prioritizedProfileKeys: strongestProfiles.filter((row) => row.recommendation === "best_now").map((row) => row.key),
      filteredProfileKeys: weakestProfiles
        .filter((row) => row.recommendation === "filter_early" || row.recommendation === "weak_now")
        .map((row) => row.key),
      supplierBoostByMarketplace: Object.fromEntries(
        sortedCombos.map((row) => [`${row.supplierKey}:${row.marketplaceKey}`, row.opportunityScore])
      ),
    },
  };
}
