type CategoryRule = {
  label: string;
  categoryId: string;
  categoryName: string;
  keywords: string[];
};

export type EbayCategoryClassificationInput = {
  supplierTitle: string | null;
  marketplaceTitle: string | null;
  marketplaceRawPayload: unknown;
};

export type EbayCategoryClassificationResult = {
  categoryId: string | null;
  categoryName: string | null;
  confidence: number;
  ruleLabel: string | null;
  matchedKeywords: string[];
  sellerFeedback: number | null;
  reason: string;
  manualReviewRequired: boolean;
};

const CATEGORY_CONFIDENCE_THRESHOLD = 0.75;
const SAFE_HOME_DECOR_OTHER_CATEGORY_ID = "10034";
const LIGHTING_OTHER_CATEGORY_ID = "3201";
const CAR_ACCESSORIES_CATEGORY_ID = "6028";

const RULES: CategoryRule[] = [
  {
    label: "lighting-other",
    categoryId: LIGHTING_OTHER_CATEGORY_ID,
    categoryName: "Home & Garden > Lamps, Lighting & Ceiling Fans > Other Lighting & Ceiling Fans",
    keywords: ["light", "lamp", "rgb"],
  },
  {
    label: "car-accessories",
    categoryId: CAR_ACCESSORIES_CATEGORY_ID,
    categoryName: "eBay Motors > Parts & Accessories",
    keywords: ["car"],
  },
  {
    label: "safe-home-decor-other",
    categoryId: SAFE_HOME_DECOR_OTHER_CATEGORY_ID,
    categoryName: "Home & Garden > Home Decor > Other Home Decor",
    keywords: ["speaker", "bluetooth"],
  },
];

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function includesToken(text: string, token: string): boolean {
  return text.includes(token.toLowerCase());
}

function extractSellerFeedback(rawPayload: unknown): number | null {
  const payload = objectOrNull(rawPayload);
  const seller = objectOrNull(payload?.seller);
  const value = Number(seller?.feedbackScore);
  return Number.isFinite(value) ? value : null;
}

function buildKeywordMatch(rule: CategoryRule, title: string): string[] {
  return rule.keywords.filter((keyword) => includesToken(title, keyword));
}

export function classifyEbayCategory(
  input: EbayCategoryClassificationInput
): EbayCategoryClassificationResult {
  const supplierTitle = cleanString(input.supplierTitle) ?? "";
  const marketplaceTitle = cleanString(input.marketplaceTitle) ?? "";
  const combinedTitle = `${supplierTitle} ${marketplaceTitle}`.trim().toLowerCase();
  const sellerFeedback = extractSellerFeedback(input.marketplaceRawPayload);

  if (!combinedTitle) {
    return {
      categoryId: null,
      categoryName: null,
      confidence: 0,
      ruleLabel: null,
      matchedKeywords: [],
      sellerFeedback,
      reason: "missing supplier and marketplace title for category classification",
      manualReviewRequired: true,
    };
  }

  if (sellerFeedback != null && sellerFeedback < 5) {
    return {
      categoryId: SAFE_HOME_DECOR_OTHER_CATEGORY_ID,
      categoryName: "Home & Garden > Home Decor > Other Home Decor",
      confidence: 0.98,
      ruleLabel: "seller-feedback-safe-override",
      matchedKeywords: [],
      sellerFeedback,
      reason: `seller feedback ${sellerFeedback} is below 5, forcing safe category`,
      manualReviewRequired: false,
    };
  }

  for (const rule of RULES) {
    const matchedKeywords = buildKeywordMatch(rule, combinedTitle);
    if (!matchedKeywords.length) continue;

    const confidence = Math.min(0.95, 0.78 + matchedKeywords.length * 0.08);
    return {
      categoryId: rule.categoryId,
      categoryName: rule.categoryName,
      confidence,
      ruleLabel: rule.label,
      matchedKeywords,
      sellerFeedback,
      reason: `matched keywords for rule '${rule.label}'`,
      manualReviewRequired: confidence < CATEGORY_CONFIDENCE_THRESHOLD,
    };
  }

  return {
    categoryId: null,
    categoryName: null,
    confidence: 0,
    ruleLabel: null,
    matchedKeywords: [],
    sellerFeedback,
    reason: "no keyword category rule matched the product titles",
    manualReviewRequired: true,
  };
}

export { CATEGORY_CONFIDENCE_THRESHOLD };
