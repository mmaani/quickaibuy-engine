import type { MarketplaceCandidate } from "./ebay";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "new",
  "original",
  "authentic",
  "pack",
  "set",
  "pcs",
  "piece",
  "pieces",
  "ml",
  "oz",
  "inch",
  "inches",
  "sample",
  "samples",
  "temu",
  "alibaba",
  "aliexpress",
  "amazon",
  "ebay",
]);

const PRIORITY_MODIFIERS = new Set([
  "usb",
  "mini",
  "portable",
  "rechargeable",
  "wireless",
  "cordless",
  "handheld",
  "travel",
  "compact",
]);

const BASE_PRODUCT_NOUNS = new Set([
  "vacuum",
  "blender",
  "cleaner",
  "fan",
  "lamp",
  "bottle",
]);

const GENERIC_TITLE_PATTERNS = [
  /\boffice\b/i,
  /\bhome and car\b/i,
  /\bcar and office\b/i,
  /\btwo speeds?\b/i,
  /\bhome\b/i,
];

const SUBTYPE_TOKENS = [
  "pet",
  "pet hair",
  "motorized",
  "brush",
  "apex",
  "air pump",
  "blower",
  "4 in 1",
  "4-in-1",
  "2 in 1",
  "2-in-1",
];

const PREMIUM_HINTS = [
  "apex",
  "pro",
  "max",
  "ultra",
  "premium",
];

export function normalizeText(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-/.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[\s\-/.]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1 && !STOPWORDS.has(x));
}

export function dedupeKeepOrder(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const v = value.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }

  return out;
}

export function parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return dedupeKeepOrder(
      raw.map((x) => normalizeText(String(x))).filter(Boolean)
    );
  }

  if (typeof raw === "string") {
    return dedupeKeepOrder(
      raw
        .split(/[,;|/]+/)
        .map((x) => normalizeText(x))
        .filter(Boolean)
    );
  }

  return [];
}

export function extractMainKeywordsFromRawPayload(rawPayload: unknown): string[] {
  if (!rawPayload || typeof rawPayload !== "object") return [];

  const obj = rawPayload as Record<string, unknown>;

  const candidates: unknown[] = [
    obj.main_keywords,
    obj.mainKeywords,
    obj.keywords,
    obj.tags,
    obj.search_terms,
    obj.searchTerms,
    obj.category_keywords,
    obj.categoryKeywords,
    obj.brand,
    obj.vendor,
    obj.type,
    obj.product_type,
  ];

  const out: string[] = [];

  for (const c of candidates) {
    out.push(...parseKeywords(c));
  }

  return dedupeKeepOrder(out);
}

function pickBaseNoun(tokens: string[]): string {
  for (const token of tokens) {
    if (BASE_PRODUCT_NOUNS.has(token)) return token;
  }
  return tokens[tokens.length - 1] || "";
}

function buildCoreTokenSet(titleTokens: string[], keywordTokens: string[]): string[] {
  return dedupeKeepOrder([...titleTokens, ...keywordTokens]).slice(0, 8);
}

function makeQuery(tokens: string[]): string {
  return dedupeKeepOrder(tokens).filter(Boolean).join(" ").trim();
}

function orderedPriorityModifiers(tokens: string[], baseNoun: string): string[] {
  return tokens.filter((t) => t !== baseNoun && PRIORITY_MODIFIERS.has(t));
}

function orderedRegularTokens(tokens: string[], baseNoun: string): string[] {
  return tokens.filter((t) => t !== baseNoun && !PRIORITY_MODIFIERS.has(t));
}

export function buildSearchQueries(input: {
  title: string;
  mainKeywords?: string[];
}): string[] {
  const titleTokens = tokenize(input.title);
  const keywordTokens = dedupeKeepOrder(
    (input.mainKeywords || []).flatMap((x) => tokenize(x))
  ).slice(0, 8);

  const coreTokens = buildCoreTokenSet(titleTokens, keywordTokens);
  const baseNoun = pickBaseNoun(coreTokens);

  const priorityModifiers = orderedPriorityModifiers(coreTokens, baseNoun);
  const regularTokens = orderedRegularTokens(coreTokens, baseNoun);

  const naturalTitleQuery = makeQuery(titleTokens.slice(0, 5));
  const nounLeadingQuery = makeQuery([baseNoun, ...priorityModifiers.slice(0, 2), ...regularTokens.slice(0, 1)]);
  const naturalCoreQuery = makeQuery(coreTokens.slice(0, 4));
  const modifierLeadingQuery = makeQuery([...priorityModifiers.slice(0, 2), baseNoun, ...regularTokens.slice(0, 1)]);

  const queries = dedupeKeepOrder([
    naturalTitleQuery,
    naturalCoreQuery,
    nounLeadingQuery,
    modifierLeadingQuery,
  ]).filter(Boolean);

  return queries.slice(0, 4);
}

export function jaccardSimilarity(a: string, b: string): number {
  const aa = new Set(tokenize(a));
  const bb = new Set(tokenize(b));
  if (!aa.size || !bb.size) return 0;

  let intersection = 0;
  for (const x of aa) {
    if (bb.has(x)) intersection++;
  }

  const union = new Set([...aa, ...bb]).size;
  return union === 0 ? 0 : intersection / union;
}

export function keywordOverlap(productTerms: string[], candidateTitle: string): number {
  const pp = new Set(productTerms.flatMap((x) => tokenize(x)));
  const cc = new Set(tokenize(candidateTitle));
  if (!pp.size || !cc.size) return 0;

  let overlap = 0;
  for (const x of pp) {
    if (cc.has(x)) overlap++;
  }

  return overlap / pp.size;
}

function exactPhraseBonus(productTitle: string, candidateTitle: string): number {
  const productNorm = normalizeText(productTitle);
  const candidateNorm = normalizeText(candidateTitle);

  if (!productNorm || !candidateNorm) return 0;

  if (candidateNorm.includes(productNorm)) return 0.08;

  const productTokens = tokenize(productTitle);
  const compactPhrase = productTokens.slice(0, 3).join(" ");
  if (compactPhrase && candidateNorm.includes(compactPhrase)) return 0.04;

  return 0;
}

function genericTitlePenalty(candidateTitle: string): number {
  let penalty = 0;
  for (const pattern of GENERIC_TITLE_PATTERNS) {
    if (pattern.test(candidateTitle)) penalty += 0.04;
  }
  return penalty;
}

function hasTokenOrPhrase(text: string, token: string): boolean {
  return normalizeText(text).includes(normalizeText(token));
}

function subtypeMismatchPenalty(productTitle: string, candidateTitle: string): number {
  const productNorm = normalizeText(productTitle);
  const candidateNorm = normalizeText(candidateTitle);

  let penalty = 0;

  for (const token of SUBTYPE_TOKENS) {
    const inProduct = hasTokenOrPhrase(productNorm, token);
    const inCandidate = hasTokenOrPhrase(candidateNorm, token);
    if (!inProduct && inCandidate) {
      penalty += 0.035;
    }
  }

  return penalty;
}

function premiumHintPenalty(productTitle: string, candidateTitle: string): number {
  const productNorm = normalizeText(productTitle);
  const candidateNorm = normalizeText(candidateTitle);

  let penalty = 0;

  for (const token of PREMIUM_HINTS) {
    const inProduct = hasTokenOrPhrase(productNorm, token);
    const inCandidate = hasTokenOrPhrase(candidateNorm, token);
    if (!inProduct && inCandidate) {
      penalty += 0.025;
    }
  }

  return penalty;
}

export function computePricePreferenceScore(price: number | null | undefined): number {
  if (price == null || !Number.isFinite(price) || price <= 0) return 0;

  if (price <= 15) return 0.03;
  if (price <= 25) return 0.02;
  if (price <= 40) return 0.01;
  if (price <= 60) return 0;
  if (price <= 90) return -0.01;
  return -0.02;
}

export function scoreCandidate(
  product: {
    title: string;
    mainKeywords?: string[];
  },
  candidate: MarketplaceCandidate
): MarketplaceCandidate {
  const titleSimilarityScore = jaccardSimilarity(product.title, candidate.matchedTitle);
  const keywordScore = keywordOverlap(
    [product.title, ...(product.mainKeywords || [])],
    candidate.matchedTitle
  );

  const bonus = exactPhraseBonus(product.title, candidate.matchedTitle);
  const genericPenalty = genericTitlePenalty(candidate.matchedTitle);
  const subtypePenalty = subtypeMismatchPenalty(product.title, candidate.matchedTitle);
  const premiumPenalty = premiumHintPenalty(product.title, candidate.matchedTitle);

  const rawScore =
    (0.78 * titleSimilarityScore) +
    (0.22 * keywordScore) +
    bonus -
    genericPenalty -
    subtypePenalty -
    premiumPenalty;

  const finalMatchScore = Math.max(0, Math.min(1, rawScore));

  return {
    ...candidate,
    titleSimilarityScore: Number(titleSimilarityScore.toFixed(4)),
    keywordScore: Number(keywordScore.toFixed(4)),
    finalMatchScore: Number(finalMatchScore.toFixed(4)),
  };
}
