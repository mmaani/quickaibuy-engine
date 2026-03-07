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
]);

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

export function buildSearchQueries(input: {
  title: string;
  mainKeywords?: string[];
}): string[] {
  const titleTokens = tokenize(input.title);
  const coreTitle = titleTokens.slice(0, 8).join(" ").trim();

  const keywordTokens = dedupeKeepOrder(
    (input.mainKeywords || []).flatMap((x) => tokenize(x))
  ).slice(0, 8);

  const keywordQuery = keywordTokens.join(" ").trim();

  return dedupeKeepOrder(
    [
      coreTitle,
      keywordQuery,
      titleTokens.slice(0, 5).join(" "),
      `${coreTitle} ${keywordQuery}`.trim(),
    ].filter(Boolean)
  ).slice(0, 4);
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
  const finalMatchScore = (0.65 * titleSimilarityScore) + (0.35 * keywordScore);

  return {
    ...candidate,
    titleSimilarityScore: Number(titleSimilarityScore.toFixed(4)),
    keywordScore: Number(keywordScore.toFixed(4)),
    finalMatchScore: Number(finalMatchScore.toFixed(4)),
  };
}
