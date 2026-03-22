type CategoryEvidence = {
  categoryId: string;
  categoryName: string | null;
};

type CategoryRule = {
  label: string;
  keywords: string[];
  categoryTokens: string[];
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
  matchedCategoryTokens: string[];
  reason: string;
  manualReviewRequired: boolean;
};

const CATEGORY_CONFIDENCE_THRESHOLD = 0.75;

const RULES: CategoryRule[] = [
  {
    label: "consumer-electronics-speakers",
    keywords: ["speaker", "bluetooth", "portable audio", "audio"],
    categoryTokens: ["speaker", "audio", "sound therapy", "portable"],
  },
  {
    label: "home-cleaning-vacuums",
    keywords: ["vacuum", "cleaner", "cleaning"],
    categoryTokens: ["vacuum", "cleaning", "household supplies"],
  },
  {
    label: "ebay-motors-car-accessories",
    keywords: ["car", "automotive", "vehicle", "seat", "dashboard"],
    categoryTokens: ["car", "truck", "interior", "automotive", "vehicle"],
  },
  {
    label: "home-kitchen",
    keywords: ["kitchen", "sink", "dish", "scrubber", "storage", "organizer"],
    categoryTokens: ["kitchen", "home", "storage", "cleaning", "dish"],
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

function extractCategoryEvidence(rawPayload: unknown): CategoryEvidence[] {
  const payload = objectOrNull(rawPayload);
  if (!payload) return [];

  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const categoryEvidence = categories
    .map((entry) => {
      const category = objectOrNull(entry);
      const categoryId = cleanString(category?.categoryId);
      if (!categoryId || !/^\d+$/.test(categoryId)) return null;
      return {
        categoryId,
        categoryName: cleanString(category?.categoryName),
      } satisfies CategoryEvidence;
    })
    .filter((entry): entry is CategoryEvidence => entry != null);

  const leafIds = Array.isArray(payload.leafCategoryIds)
    ? payload.leafCategoryIds
        .map((value) => cleanString(value))
        .filter((value): value is string => value != null && /^\d+$/.test(value))
    : [];

  const prioritized: CategoryEvidence[] = [];

  for (const leafId of leafIds) {
    const matching = categoryEvidence.find((entry) => entry.categoryId === leafId);
    if (matching) prioritized.push(matching);
    else prioritized.push({ categoryId: leafId, categoryName: null });
  }

  for (const entry of categoryEvidence) {
    if (!prioritized.some((existing) => existing.categoryId === entry.categoryId)) {
      prioritized.push(entry);
    }
  }

  return prioritized;
}

export function classifyEbayCategory(
  input: EbayCategoryClassificationInput
): EbayCategoryClassificationResult {
  const supplierTitle = cleanString(input.supplierTitle) ?? "";
  const marketplaceTitle = cleanString(input.marketplaceTitle) ?? "";
  const combinedTitle = `${supplierTitle} ${marketplaceTitle}`.trim().toLowerCase();
  const evidence = extractCategoryEvidence(input.marketplaceRawPayload);

  if (!combinedTitle) {
    return {
      categoryId: null,
      categoryName: null,
      confidence: 0,
      ruleLabel: null,
      matchedKeywords: [],
      matchedCategoryTokens: [],
      reason: "missing supplier and marketplace title for category classification",
      manualReviewRequired: true,
    };
  }

  let best: EbayCategoryClassificationResult | null = null;

  for (const rule of RULES) {
    const matchedKeywords = rule.keywords.filter((keyword) => includesToken(combinedTitle, keyword));
    if (!matchedKeywords.length) continue;

    for (const candidate of evidence) {
      const categoryName = (candidate.categoryName ?? "").toLowerCase();
      const matchedCategoryTokens = rule.categoryTokens.filter((token) => includesToken(categoryName, token));
      const confidence =
        0.55 +
        Math.min(0.2, matchedKeywords.length * 0.1) +
        Math.min(0.25, matchedCategoryTokens.length * 0.125);

      const result: EbayCategoryClassificationResult = {
        categoryId: candidate.categoryId,
        categoryName: candidate.categoryName,
        confidence,
        ruleLabel: rule.label,
        matchedKeywords,
        matchedCategoryTokens,
        reason: matchedCategoryTokens.length
          ? `matched rule '${rule.label}' against marketplace category '${candidate.categoryName ?? candidate.categoryId}'`
          : `matched rule '${rule.label}' by keywords only, but marketplace category evidence was weak`,
        manualReviewRequired:
          matchedCategoryTokens.length === 0 || confidence < CATEGORY_CONFIDENCE_THRESHOLD,
      };

      if (!best || result.confidence > best.confidence) {
        best = result;
      }
    }

    if (!evidence.length) {
      const keywordOnly: EbayCategoryClassificationResult = {
        categoryId: null,
        categoryName: null,
        confidence: 0.5 + Math.min(0.2, matchedKeywords.length * 0.1),
        ruleLabel: rule.label,
        matchedKeywords,
        matchedCategoryTokens: [],
        reason: `matched rule '${rule.label}' by keywords but marketplace category evidence was unavailable`,
        manualReviewRequired: true,
      };
      if (!best || keywordOnly.confidence > best.confidence) {
        best = keywordOnly;
      }
    }
  }

  if (best) return best;

  return {
    categoryId: null,
    categoryName: null,
    confidence: 0,
    ruleLabel: null,
    matchedKeywords: [],
    matchedCategoryTokens: [],
    reason: "no category keyword rule matched the product titles",
    manualReviewRequired: true,
  };
}

export { CATEGORY_CONFIDENCE_THRESHOLD };
