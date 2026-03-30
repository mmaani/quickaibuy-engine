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
  "case",
  "cover",
  "pouch",
  "holder",
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

const PREMIUM_HINTS = ["apex", "pro", "max", "ultra", "premium"];

const PRODUCT_FORM_TOKENS: Record<string, string[]> = {
  case: ["case", "cover", "pouch", "shell", "holder", "sleeve", "bag"],
  fan: ["fan", "cooler", "blower"],
  vacuum: ["vacuum", "suction", "cleaner"],
  lamp: ["lamp", "light", "lantern"],
  bottle: ["bottle", "flask", "cup", "mug"],
};

const SPEC_UNIT_REGEX = /(\d+(?:\.\d+)?)\s?(ml|l|oz|g|kg|lb|mah|w|v|cm|mm|inch|in|"|ft)/gi;
const PACK_REGEX = /(\d+)\s?(pack|pcs|pieces|count|ct|pk)\b/i;
const MULTI_REGEX = /(\d+)\s?[x×]\b/i;

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
    return dedupeKeepOrder(raw.map((x) => normalizeText(String(x))).filter(Boolean));
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

export function buildSearchQueries(input: { title: string; mainKeywords?: string[] }): string[] {
  const titleTokens = tokenize(input.title);
  const keywordTokens = dedupeKeepOrder((input.mainKeywords || []).flatMap((x) => tokenize(x))).slice(
    0,
    8
  );

  const coreTokens = buildCoreTokenSet(titleTokens, keywordTokens);
  const baseNoun = pickBaseNoun(coreTokens);

  const priorityModifiers = orderedPriorityModifiers(coreTokens, baseNoun);
  const regularTokens = orderedRegularTokens(coreTokens, baseNoun);

  const naturalTitleQuery = makeQuery(titleTokens.slice(0, 5));
  const nounLeadingQuery = makeQuery([
    baseNoun,
    ...priorityModifiers.slice(0, 2),
    ...regularTokens.slice(0, 1),
  ]);
  const naturalCoreQuery = makeQuery(coreTokens.slice(0, 4));
  const modifierLeadingQuery = makeQuery([
    ...priorityModifiers.slice(0, 2),
    baseNoun,
    ...regularTokens.slice(0, 1),
  ]);

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

function diceCoefficient(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const aa = new Set(a);
  const bb = new Set(b);
  let overlap = 0;
  for (const x of aa) {
    if (bb.has(x)) overlap++;
  }
  return (2 * overlap) / (aa.size + bb.size);
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return out;
}

function charTrigrams(input: string): string[] {
  const text = normalizeText(input).replace(/\s+/g, "_");
  const out: string[] = [];
  for (let i = 0; i <= text.length - 3; i += 1) {
    out.push(text.slice(i, i + 3));
  }
  return out;
}

function semanticTitleSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const tokenDice = diceCoefficient(tokensA, tokensB);
  const bigramDice = diceCoefficient(bigrams(tokensA), bigrams(tokensB));
  const trigramDice = diceCoefficient(charTrigrams(a), charTrigrams(b));
  return Number((0.5 * tokenDice + 0.3 * bigramDice + 0.2 * trigramDice).toFixed(4));
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

function extractBrand(productTitle: string, mainKeywords?: string[], rawPayload?: unknown): string | null {
  const values: string[] = [];

  if (rawPayload && typeof rawPayload === "object") {
    const obj = rawPayload as Record<string, unknown>;
    values.push(String(obj.brand ?? ""));
    values.push(String(obj.vendor ?? ""));
    values.push(String(obj.manufacturer ?? ""));
  }

  values.push(...(mainKeywords ?? []));
  values.push(productTitle);

  for (const value of values) {
    const tokens = normalizeText(value).split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const first = tokens[0];
    if (first.length >= 3 && !STOPWORDS.has(first)) return first;
  }

  return null;
}

function brandAlignmentScore(productBrand: string | null, candidateTitle: string): number {
  if (!productBrand) return 0.5;
  return hasTokenOrPhrase(candidateTitle, productBrand) ? 1 : 0;
}

function detectProductForm(text: string): string | null {
  const normalized = normalizeText(text);
  for (const [form, tokens] of Object.entries(PRODUCT_FORM_TOKENS)) {
    if (tokens.some((token) => normalized.includes(token))) return form;
  }
  return null;
}

function productTypeAlignment(productTitle: string, candidateTitle: string): { score: number; penalty: number } {
  const productForm = detectProductForm(productTitle);
  const candidateForm = detectProductForm(candidateTitle);

  if (!productForm || !candidateForm) return { score: 0.6, penalty: 0 };
  if (productForm === candidateForm) return { score: 1, penalty: 0 };

  return { score: 0, penalty: 0.2 };
}

function extractPackCount(input: string): number | null {
  const normalized = normalizeText(input);
  const packMatch = normalized.match(PACK_REGEX);
  if (packMatch) return Number(packMatch[1]);
  const multiMatch = normalized.match(MULTI_REGEX);
  if (multiMatch) return Number(multiMatch[1]);
  return null;
}

function packAlignment(productTitle: string, candidateTitle: string): { score: number; penalty: number; productPack: number | null; candidatePack: number | null } {
  const productPack = extractPackCount(productTitle);
  const candidatePack = extractPackCount(candidateTitle);

  if (!productPack || !candidatePack) {
    return { score: 0.6, penalty: 0, productPack, candidatePack };
  }

  if (productPack === candidatePack) {
    return { score: 1, penalty: 0, productPack, candidatePack };
  }

  const ratio = Math.max(productPack, candidatePack) / Math.max(1, Math.min(productPack, candidatePack));
  const penalty = ratio >= 2 ? 0.16 : 0.08;
  return { score: 0, penalty, productPack, candidatePack };
}

type ParsedSpec = { value: number; unit: string };

function parseSpecs(input: string): ParsedSpec[] {
  const normalized = normalizeText(input);
  const out: ParsedSpec[] = [];
  for (const match of normalized.matchAll(SPEC_UNIT_REGEX)) {
    const value = Number(match[1]);
    const unit = String(match[2] || "").toLowerCase();
    if (!Number.isFinite(value) || value <= 0 || !unit) continue;
    out.push({ value, unit: unit === '"' ? "inch" : unit });
  }
  return out;
}

function specAlignment(productTitle: string, candidateTitle: string): { score: number; penalty: number } {
  const productSpecs = parseSpecs(productTitle);
  const candidateSpecs = parseSpecs(candidateTitle);

  if (!productSpecs.length || !candidateSpecs.length) return { score: 0.6, penalty: 0 };

  let matched = 0;
  let mismatched = 0;

  for (const p of productSpecs) {
    const sameUnit = candidateSpecs.filter((c) => c.unit === p.unit);
    if (!sameUnit.length) continue;

    const closest = sameUnit.reduce((best, next) => {
      const bestDiff = Math.abs(best.value - p.value);
      const nextDiff = Math.abs(next.value - p.value);
      return nextDiff < bestDiff ? next : best;
    });

    const delta = Math.abs(closest.value - p.value) / Math.max(1, p.value);
    if (delta <= 0.2) matched++;
    else mismatched++;
  }

  if (!matched && !mismatched) return { score: 0.6, penalty: 0 };

  const score = matched / (matched + mismatched);
  const penalty = mismatched > 0 ? Math.min(0.18, mismatched * 0.06) : 0;
  return { score, penalty };
}

function parseSupplierPrice(rawPayload: unknown): number | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const obj = rawPayload as Record<string, unknown>;
  const candidates = [
    obj.price,
    obj.priceMin,
    obj.price_min,
    obj.offerPrice,
    obj.offer_price,
    obj.unitPrice,
    obj.unit_price,
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }

  return null;
}

function computePriceSanityScore(supplierPrice: number | null, marketplacePrice: number | null): { score: number; penalty: number; ratio: number | null } {
  if (!supplierPrice || !marketplacePrice) return { score: 0.5, penalty: 0, ratio: null };
  const ratio = marketplacePrice / supplierPrice;

  if (!Number.isFinite(ratio) || ratio <= 0) return { score: 0.2, penalty: 0.08, ratio: null };
  if (ratio < 1.2) return { score: 0.2, penalty: 0.08, ratio: Number(ratio.toFixed(4)) };
  if (ratio <= 4.5) return { score: 1, penalty: 0, ratio: Number(ratio.toFixed(4)) };
  if (ratio <= 8) return { score: 0.35, penalty: 0.06, ratio: Number(ratio.toFixed(4)) };

  return { score: 0, penalty: 0.12, ratio: Number(ratio.toFixed(4)) };
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

function round4(value: number): number {
  return Number(value.toFixed(4));
}

export function scoreCandidate(
  product: {
    title: string;
    mainKeywords?: string[];
    rawPayload?: unknown;
  },
  candidate: MarketplaceCandidate
): MarketplaceCandidate {
  const lexicalSimilarityScore = jaccardSimilarity(product.title, candidate.matchedTitle);
  const keywordScore = keywordOverlap([product.title, ...(product.mainKeywords || [])], candidate.matchedTitle);
  const semanticSimilarityScore = semanticTitleSimilarity(product.title, candidate.matchedTitle);

  const bonus = exactPhraseBonus(product.title, candidate.matchedTitle);
  const genericPenalty = genericTitlePenalty(candidate.matchedTitle);
  const subtypePenalty = subtypeMismatchPenalty(product.title, candidate.matchedTitle);
  const premiumPenalty = premiumHintPenalty(product.title, candidate.matchedTitle);

  const productBrand = extractBrand(product.title, product.mainKeywords, product.rawPayload);
  const brandAlignment = brandAlignmentScore(productBrand, candidate.matchedTitle);
  const typeAlignment = productTypeAlignment(product.title, candidate.matchedTitle);
  const packTruth = packAlignment(product.title, candidate.matchedTitle);
  const specTruth = specAlignment(product.title, candidate.matchedTitle);
  const priceSanity = computePriceSanityScore(
    parseSupplierPrice(product.rawPayload),
    candidate.price ?? null
  );

  const penalties =
    genericPenalty +
    subtypePenalty +
    premiumPenalty +
    typeAlignment.penalty +
    packTruth.penalty +
    specTruth.penalty +
    priceSanity.penalty;

  const productTruthScore =
    0.3 * brandAlignment +
    0.28 * typeAlignment.score +
    0.2 * packTruth.score +
    0.22 * specTruth.score;

  const rawScore =
    0.32 * semanticSimilarityScore +
    0.2 * lexicalSimilarityScore +
    0.08 * keywordScore +
    0.32 * productTruthScore +
    0.08 * priceSanity.score +
    bonus -
    penalties;

  const finalMatchScore = Math.max(0, Math.min(1, rawScore));

  return {
    ...candidate,
    titleSimilarityScore: round4(lexicalSimilarityScore),
    keywordScore: round4(keywordScore),
    semanticSimilarityScore: round4(semanticSimilarityScore),
    productTruthScore: round4(productTruthScore),
    priceSanityScore: round4(priceSanity.score),
    finalMatchScore: round4(finalMatchScore),
    matchEvidence: {
      semanticSimilarity: round4(semanticSimilarityScore),
      lexicalSimilarity: round4(lexicalSimilarityScore),
      keywordOverlap: round4(keywordScore),
      brandAlignment: round4(brandAlignment),
      productTypeAlignment: round4(typeAlignment.score),
      specAlignment: round4(specTruth.score),
      quantityPackAlignment: round4(packTruth.score),
      quantityPackValues: {
        productPack: packTruth.productPack,
        candidatePack: packTruth.candidatePack,
      },
      priceSanityContribution: {
        score: round4(priceSanity.score),
        ratio: priceSanity.ratio,
      },
      penalties: {
        generic: round4(genericPenalty),
        subtypeMismatch: round4(subtypePenalty),
        premiumVariantMismatch: round4(premiumPenalty),
        productFormMismatch: round4(typeAlignment.penalty),
        packMismatch: round4(packTruth.penalty),
        specMismatch: round4(specTruth.penalty),
        priceOutlierPenalty: round4(priceSanity.penalty),
      },
      finalSelectionReason:
        finalMatchScore >= 0.7
          ? "high_semantic_and_product_truth_alignment"
          : finalMatchScore >= 0.5
            ? "moderate_alignment_with_penalties"
            : "low_alignment_or_variant_mismatch",
    },
  };
}
