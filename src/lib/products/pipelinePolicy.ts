import { scoreSellability } from "@/lib/products/sellabilityScore";

type SupplierSnapshotQuality = "HIGH" | "MEDIUM" | "LOW" | "STUB";
type AvailabilitySignal = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";

export type PipelineNiche =
  | "ambient-lighting"
  | "desk-product"
  | "car-accessory"
  | "portable-fan"
  | "gift-decor";

export type ProductPipelinePolicyInput = {
  title: string | null;
  marketplaceTitle?: string | null;
  supplierTitle?: string | null;
  imageUrl?: string | null;
  additionalImageCount?: number;
  mediaQualityScore?: number | null;
  supplierKey?: string | null;
  supplierQuality?: SupplierSnapshotQuality | null;
  telemetrySignals?: string[] | null;
  availabilitySignal?: AvailabilitySignal | null;
  availabilityConfidence?: number | null;
  shippingEstimates?: unknown;
  shippingConfidence?: number | null;
  actionableSnapshot?: boolean | null;
  supplierRowDecision?: "ACTIONABLE" | "MANUAL_REVIEW" | "BLOCKED" | null;
  supplierPrice?: number | null;
  marketplacePrice?: number | null;
  matchConfidence?: number | null;
  marginPct?: number | null;
  roiPct?: number | null;
};

export type ProductPipelinePolicyResult = {
  eligible: boolean;
  manualReview: boolean;
  score: number;
  niche: PipelineNiche | null;
  boosts: string[];
  penalties: string[];
  reasons: string[];
  flags: string[];
  simpleLowRisk: boolean;
  strongMedia: boolean;
  titleClarityStrong: boolean;
  supplierQualityStrong: boolean;
  shippingStable: boolean;
  newSellerFriendly: boolean;
};

export type MatchAcceptanceResult = {
  accepted: boolean;
  manualReview: boolean;
  reason: string;
};

export type MatchRoutingStatus = "ACTIVE" | "MANUAL_REVIEW" | "REJECTED";

export const PRODUCT_PIPELINE_MARGIN_MIN = 30;
export const PRODUCT_PIPELINE_ROI_MIN = 80;
export const PRODUCT_PIPELINE_MATCH_PREFERRED_MIN = 0.8;
export const PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN = 0.7;

export function getMatchRoutingStatus(confidence: number): MatchRoutingStatus {
  if (confidence >= PRODUCT_PIPELINE_MATCH_PREFERRED_MIN) return "ACTIVE";
  if (confidence >= PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN) return "MANUAL_REVIEW";
  return "REJECTED";
}

export function isMatchListingEligible(confidence: number): boolean {
  return getMatchRoutingStatus(confidence) === "ACTIVE";
}

const DISCOVERY_FOCUS_KEYWORDS = [
  "ambient night light",
  "bedside lamp",
  "decorative crystal lamp",
  "acrylic lamp",
  "wireless charging night light",
  "magnetic car phone mount",
  "mini portable fan",
  "desk decor gadget",
  "desk organizer decor",
  "ambient desk lamp",
];

const NICHE_RULES: Array<{ niche: PipelineNiche; keywords: string[] }> = [
  {
    niche: "ambient-lighting",
    keywords: ["night light", "ambient", "lamp", "bedside", "crystal lamp", "acrylic lamp"],
  },
  {
    niche: "car-accessory",
    keywords: ["car mount", "phone mount", "magnetic mount", "car accessory"],
  },
  {
    niche: "portable-fan",
    keywords: ["portable fan", "mini fan", "desk fan", "handheld fan"],
  },
  {
    niche: "desk-product",
    keywords: ["desk", "organizer", "pen holder", "desk gadget", "desk decor"],
  },
  {
    niche: "gift-decor",
    keywords: ["decor gift", "gift decor", "home decor", "decor"],
  },
];

const BOOST_PATTERNS: Array<{ label: string; keywords: string[] }> = [
  { label: "ambient-lighting-pattern", keywords: ["night light", "ambient lamp", "bedside lamp"] },
  { label: "decor-gift-pattern", keywords: ["decor gift", "gift", "home decor"] },
  { label: "magnetic-car-mount-pattern", keywords: ["magnetic car phone mount", "car mount"] },
  { label: "mini-fan-pattern", keywords: ["mini portable fan", "portable fan", "desk fan"] },
  { label: "simple-desk-gadget-pattern", keywords: ["desk gadget", "desk decor", "organizer"] },
];

const HARD_EXCLUDE_KEYWORDS = [
  "medical",
  "therapy",
  "blood pressure",
  "glucose",
  "surveillance",
  "spy camera",
  "security camera",
  "hidden camera",
  "gps tracker",
  "tracking device",
  "hearing aid",
  "massage gun",
  "ecg",
  "ce certification",
  "certification",
  "drug",
  "adult",
];

const BRAND_RISK_KEYWORDS = [
  "apple",
  "samsung",
  "nike",
  "adidas",
  "tesla",
  "bmw",
  "mercedes",
  "disney",
  "marvel",
  "pokemon",
];

const HIGH_RISK_ELECTRONICS_KEYWORDS = [
  "camera",
  "router",
  "wifi",
  "bluetooth speaker",
  "dash cam",
  "drone",
  "projector",
  "walkie talkie",
  "surveillance",
  "gps",
];

const COMPLEXITY_KEYWORDS = [
  "multifunction",
  "multi-function",
  "2 in 1",
  "3 in 1",
  "app control",
  "voice control",
  "smart",
  "certified",
  "professional",
];

function normalizeText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => {
    const normalized = keyword.toLowerCase().trim();
    if (!normalized) return false;
    if (normalized.includes(" ")) return text.includes(normalized);
    return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "i").test(text);
  });
}

function countMatches(text: string, keywords: string[]): number {
  return keywords.filter((keyword) => {
    const normalized = keyword.toLowerCase().trim();
    if (!normalized) return false;
    if (normalized.includes(" ")) return text.includes(normalized);
    return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "i").test(text);
  }).length;
}

export function normalizeSupplierQuality(value: string | null | undefined): SupplierSnapshotQuality | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "HIGH" || normalized === "MEDIUM" || normalized === "LOW" || normalized === "STUB") {
    return normalized;
  }
  return null;
}

function toShippingEstimateCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function inferNiche(text: string): PipelineNiche | null {
  let best: { niche: PipelineNiche; count: number } | null = null;
  for (const rule of NICHE_RULES) {
    const count = countMatches(text, rule.keywords);
    if (!count) continue;
    if (!best || count > best.count) {
      best = { niche: rule.niche, count };
    }
  }
  return best?.niche ?? null;
}

function isFocusedKeyword(keyword: string): boolean {
  return inferNiche(normalizeText(keyword)) != null;
}

export function buildFocusedSupplierDiscoverKeywords(trendKeywords: string[]): string[] {
  const combined = [...DISCOVERY_FOCUS_KEYWORDS, ...trendKeywords];
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const keyword of combined) {
    const normalized = String(keyword ?? "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    if (!isFocusedKeyword(normalized)) continue;
    seen.add(key);
    filtered.push(normalized);
  }

  return filtered;
}

const DISCOVERY_VARIANT_MAP: Record<PipelineNiche, string[]> = {
  "ambient-lighting": ["night light", "bedside lamp", "desk lamp", "crystal lamp", "acrylic lamp"],
  "desk-product": ["desk organizer", "pen holder", "desk gadget", "storage box"],
  "car-accessory": ["car phone mount", "magnetic mount", "car mount"],
  "portable-fan": ["portable fan", "desk fan", "mini fan"],
  "gift-decor": ["home decor", "decor gift", "gift decor"],
};

const DISCOVERY_NOISE_WORDS = new Set([
  "ambient",
  "decorative",
  "wireless",
  "mini",
  "portable",
  "decor",
  "gadget",
]);

export function buildSupplierSearchKeywordVariants(keyword: string): string[] {
  const normalized = normalizeText(keyword);
  if (!normalized) return [];

  const variants: string[] = [String(keyword ?? "").trim()];
  const niche = inferNiche(normalized);
  if (niche) {
    variants.push(...DISCOVERY_VARIANT_MAP[niche]);
  }

  const compactTokens = normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !DISCOVERY_NOISE_WORDS.has(token));

  if (compactTokens.length >= 2) {
    variants.push(compactTokens.slice(0, 2).join(" "));
  }
  if (compactTokens.length >= 3) {
    variants.push(compactTokens.slice(0, 3).join(" "));
  }

  return Array.from(
    new Set(
      variants
        .map((value) => value.trim())
        .filter((value) => value.length >= 3)
    )
  ).slice(0, 5);
}

export function evaluateProductPipelinePolicy(
  input: ProductPipelinePolicyInput
): ProductPipelinePolicyResult {
  const text = normalizeText(input.title, input.marketplaceTitle, input.supplierTitle);
  const niche = inferNiche(text);
  const supplierQuality = normalizeSupplierQuality(input.supplierQuality);
  const telemetry = new Set((input.telemetrySignals ?? []).map((value) => String(value).toLowerCase()));
  const additionalImageCount = Math.max(0, Number(input.additionalImageCount ?? 0));
  const mediaQualityScore = Math.max(0, Math.min(1, Number(input.mediaQualityScore ?? 0) || 0));
  const shippingConfidence = Math.max(0, Math.min(1, Number(input.shippingConfidence ?? 0) || 0));
  const actionableSnapshot = input.actionableSnapshot !== false;
  const price = input.marketplacePrice ?? input.supplierPrice ?? null;
  const sellability = scoreSellability({
    title: input.title ?? null,
    marketplaceTitle: input.marketplaceTitle ?? null,
    supplierTitle: input.supplierTitle ?? null,
    price,
    imageUrl: input.imageUrl ?? null,
    additionalImageCount,
  });

  const boosts: string[] = [];
  const penalties: string[] = [];
  const reasons: string[] = [];
  const flags = new Set<string>();

  if (!niche) {
    penalties.push("out of focus niche");
    flags.add("OUT_OF_SCOPE_NICHE");
  } else {
    reasons.push(`focused niche ${niche}`);
  }

  if (includesAny(text, HARD_EXCLUDE_KEYWORDS)) {
    penalties.push("blocked category/risk keyword");
    flags.add("HARD_EXCLUDE");
  }
  if (includesAny(text, BRAND_RISK_KEYWORDS)) {
    penalties.push("brand/trademark risk");
    flags.add("BRAND_RISK");
  }
  if (includesAny(text, HIGH_RISK_ELECTRONICS_KEYWORDS)) {
    penalties.push("high-risk electronics profile");
    flags.add("HIGH_RISK_ELECTRONICS");
  }

  const complexMatches = countMatches(text, COMPLEXITY_KEYWORDS);
  if (complexMatches > 0) {
    penalties.push("over-technical or confusing product language");
    flags.add("COMPLEX_PRODUCT");
  }

  for (const boost of BOOST_PATTERNS) {
    if (includesAny(text, boost.keywords)) boosts.push(boost.label);
  }

  const strongMedia =
    Boolean(input.imageUrl) &&
    (additionalImageCount >= 4 || mediaQualityScore >= 0.82) &&
    actionableSnapshot &&
    !telemetry.has("low_quality") &&
    !telemetry.has("challenge");
  if (!strongMedia) {
    penalties.push("weak media set");
    flags.add("WEAK_MEDIA");
  }

  const titleClarityStrong = sellability.clarity >= 8 && !penalties.includes("unclear product use");
  if (!titleClarityStrong) {
    penalties.push("unclear use case");
    flags.add("TITLE_CLARITY_WEAK");
  }

  const supplierQualityStrong =
    supplierQuality === "HIGH" || (supplierQuality === "MEDIUM" && !telemetry.has("fallback"));
  if (!supplierQualityStrong) {
    penalties.push("supplier quality weak");
    flags.add("SUPPLIER_QUALITY_WEAK");
  }
  if (telemetry.has("fallback") || telemetry.has("challenge")) {
    penalties.push("supplier telemetry fallback/challenge");
    flags.add("SUPPLIER_TELEMETRY_RISK");
  }

  const shippingEstimateCount = toShippingEstimateCount(input.shippingEstimates);
  const availabilityConfirmed =
    (input.availabilitySignal === "IN_STOCK" || input.availabilitySignal === "LOW_STOCK") &&
    (input.availabilityConfidence == null || input.availabilityConfidence >= 0.6);
  const shippingSignalPresent = shippingEstimateCount > 0 || shippingConfidence >= 0.75;
  const shippingSignalWeak = !shippingSignalPresent || shippingConfidence < 0.75;
  const shippingStable =
    actionableSnapshot &&
    input.supplierRowDecision !== "BLOCKED" &&
    availabilityConfirmed &&
    shippingSignalPresent;
  if (input.availabilitySignal === "OUT_OF_STOCK") {
    penalties.push("supplier out of stock");
    flags.add("SUPPLIER_OUT_OF_STOCK");
  } else if (input.availabilitySignal === "LOW_STOCK") {
    penalties.push("supplier low stock warning");
    flags.add("LOW_STOCK_WARNING");
  } else if (!availabilityConfirmed) {
    penalties.push("availability not confirmed");
    flags.add("AVAILABILITY_NOT_CONFIRMED");
  }
  if (!shippingSignalPresent) {
    penalties.push("shipping signal missing");
    flags.add("SHIPPING_SIGNAL_MISSING");
  } else if (shippingSignalWeak) {
    penalties.push("shipping signal weak");
    flags.add("SHIPPING_SIGNAL_WEAK");
  }
  if (!shippingStable) {
    penalties.push("shipping/availability stability weak");
    flags.add("SHIPPING_STABILITY_WEAK");
  }

  const newSellerFriendly =
    !includesAny(text, HIGH_RISK_ELECTRONICS_KEYWORDS) &&
    !includesAny(text, ["industrial", "commercial", "professional"]) &&
    complexMatches === 0;
  if (!newSellerFriendly) {
    penalties.push("not ideal for new seller profile");
    flags.add("NEW_SELLER_RISK");
  }

  let score = sellability.score;
  if (niche) score += 10;
  score += boosts.length * 4;
  if (supplierQuality === "HIGH") score += 8;
  else if (supplierQuality === "MEDIUM") score += 4;
  if (shippingStable) score += 6;
  if (newSellerFriendly) score += 8;
  if (strongMedia) score += 8;
  score -= Math.min(35, penalties.length * 5);

  if (input.marginPct != null && input.marginPct >= PRODUCT_PIPELINE_MARGIN_MIN) score += 5;
  if (input.roiPct != null && input.roiPct >= PRODUCT_PIPELINE_ROI_MIN) score += 8;
  if (input.matchConfidence != null && input.matchConfidence >= PRODUCT_PIPELINE_MATCH_PREFERRED_MIN) {
    score += 6;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const hardExcluded = flags.has("HARD_EXCLUDE") || flags.has("BRAND_RISK") || flags.has("HIGH_RISK_ELECTRONICS");
  const simpleLowRisk = complexMatches === 0 && newSellerFriendly && titleClarityStrong;
  const manualReview =
    !hardExcluded &&
    (score < 70 ||
      !strongMedia ||
      !supplierQualityStrong ||
      !shippingStable ||
      !titleClarityStrong ||
      !simpleLowRisk);
  const eligible =
    !hardExcluded &&
    niche != null &&
    score >= 70 &&
    strongMedia &&
    supplierQualityStrong &&
    shippingStable &&
    titleClarityStrong &&
    newSellerFriendly &&
    simpleLowRisk;

  return {
    eligible,
    manualReview,
    score,
    niche,
    boosts,
    penalties,
    reasons,
    flags: Array.from(flags),
    simpleLowRisk,
    strongMedia,
    titleClarityStrong,
    supplierQualityStrong,
    shippingStable,
    newSellerFriendly,
  };
}

export function evaluateMatchAcceptance(input: {
  confidence: number;
  titleSimilarityStrong: boolean;
  priceAlignmentStrong: boolean;
  strongMedia: boolean;
  simpleLowRisk: boolean;
}): MatchAcceptanceResult {
  if (input.confidence >= PRODUCT_PIPELINE_MATCH_PREFERRED_MIN) {
    return {
      accepted: true,
      manualReview: false,
      reason: "preferred confidence band accepted",
    };
  }

  if (
    input.confidence >= PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN &&
    input.titleSimilarityStrong &&
    input.priceAlignmentStrong &&
    input.strongMedia &&
    input.simpleLowRisk
  ) {
    return {
      accepted: true,
      manualReview: true,
      reason: "exception confidence band accepted with strong title/price/media/simple product checks",
    };
  }

  return {
    accepted: false,
    manualReview: input.confidence >= PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN,
    reason: "match confidence below automated acceptance policy",
  };
}
