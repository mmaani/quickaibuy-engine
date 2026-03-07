import { sql } from "drizzle-orm";
import { db } from "../db";

type JsonRow = Record<string, unknown>;

type CanonicalizeDebugStats = {
  missingTitle: number;
  missingId: number;
  missingSource: number;
  canonicalized: number;
};

type CanonicalProduct = {
  sourceKey: string;
  productId: string;
  title: string;
  titleRaw: string;
  normalizedTitle: string;
  tokens: string[];
  price: number | null;
  currency: string | null;
  barcode: string | null;
  modelTokens: string[];
  raw: JsonRow;
  ts: number;
};

export type AcceptedMatch = {
  matchId: string;
  supplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  matchType: "keyword_fuzzy" | "title_similarity" | "manual" | "exact_model" | "exact_barcode";
  confidence: number;
  evidence: Record<string, unknown>;
  status: "ACTIVE";
};

export type MatchProductsResult = {
  scannedSuppliers: number;
  scannedMarketplaceListings: number;
  evaluatedPairs: number;
  acceptedCount: number;
  accepted: AcceptedMatch[];
  debugTopRejected?: Array<Record<string, unknown>>;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
  "of", "on", "or", "that", "the", "this", "to", "with", "without", "your", "you", "our",
  "new", "best", "hot", "sale", "set", "pack", "pcs", "pc", "piece", "pieces",
  "sample", "samples", "temu", "alibaba", "aliexpress", "ebay", "amazon"
]);

const COLOR_MAP: Array<[RegExp, string]> = [
  [/\bgrey\b/g, "gray"],
  [/\bmulticolou?r\b/g, "multicolor"],
  [/\brose gold\b/g, "rosegold"],
  [/\bdark blue\b/g, "navy"],
  [/\blight blue\b/g, "skyblue"]
];

const UNIT_MAP: Array<[RegExp, string]> = [
  [/\bounces?\b|\boz\.\b|\boz\b/g, "oz"],
  [/\bmillilit(er|re)s?\b|\bml\b/g, "ml"],
  [/\blit(er|re)s?\b|\bl\b/g, "l"],
  [/\bcentimet(er|re)s?\b|\bcm\b/g, "cm"],
  [/\bmillimet(er|re)s?\b|\bmm\b/g, "mm"],
  [/\binches?\b|\bin\b/g, "in"],
  [/\bfeet\b|\bfoot\b|\bft\b/g, "ft"],
  [/\bkilograms?\b|\bkg\b/g, "kg"],
  [/\bgrams?\b|\bg\b/g, "g"],
  [/\bpounds?\b|\blb\b|\blbs\b/g, "lb"]
];

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function normalizeTitle(input: string): string {
  let s = String(input ?? "").toLowerCase();

  for (const [pattern, replacement] of COLOR_MAP) {
    s = s.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of UNIT_MAP) {
    s = s.replace(pattern, replacement);
  }

  s = s
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\b(\d+)\s+(ml|l|cm|mm|in|ft|kg|g|lb|oz)\b/g, "$1$2");

  const tokens = normalizeWhitespace(s)
    .split(" ")
    .filter(Boolean)
    .filter((t) => !STOP_WORDS.has(t));

  return tokens.join(" ");
}

function tokensFromNormalized(normalized: string): string[] {
  return Array.from(new Set(normalized.split(" ").filter(Boolean)));
}

function charBigrams(s: string): Set<string> {
  const x = ` ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < x.length - 1; i += 1) {
    out.add(x.slice(i, i + 2));
  }
  return out;
}

function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = charBigrams(a);
  const B = charBigrams(b);
  let overlap = 0;
  for (const g of A) {
    if (B.has(g)) overlap += 1;
  }
  return (2 * overlap) / (A.size + B.size || 1);
}

function tokenOverlapScore(aTokens: string[], bTokens: string[]): number {
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  let shared = 0;
  for (const t of A) {
    if (B.has(t)) shared += 1;
  }
  return (2 * shared) / (A.size + B.size || 1);
}

function tokenCoverageScore(needleTokens: string[], haystackTokens: string[]): number {
  if (!needleTokens.length) return 0;
  const haystack = new Set(haystackTokens);
  let covered = 0;
  for (const token of needleTokens) {
    if (haystack.has(token)) covered += 1;
  }
  return covered / needleTokens.length;
}

function sharedTokens(aTokens: string[], bTokens: string[]): string[] {
  const B = new Set(bTokens);
  return aTokens.filter((t) => B.has(t));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function pickString(row: JsonRow, keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function pickNumber(row: JsonRow, keys: string[]): number | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const cleaned = v.replace(/[^0-9.-]/g, "");
      const n = Number(cleaned);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function pickTimestampMs(row: JsonRow): number {
  const keys = [
    "snapshot_ts",
    "snapshotTs",
    "updated_ts",
    "updatedTs",
    "created_ts",
    "createdTs",
    "first_seen_ts",
    "firstSeenTs",
    "last_seen_ts",
    "lastSeenTs",
    "captured_ts",
    "capturedTs",
    "observed_ts",
    "observedTs",
    "scraped_ts",
    "scrapedTs"
  ];
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" || typeof v === "number") {
      const ms = new Date(v).getTime();
      if (Number.isFinite(ms)) return ms;
    }
  }
  return 0;
}

function extractModelTokens(input: string): string[] {
  const raw = String(input ?? "").toUpperCase();
  const matches = raw.match(/\b[A-Z]{1,6}[-]?\d{2,}[A-Z0-9-]*\b/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase())));
}

function extractBarcode(row: JsonRow): string | null {
  const value = pickString(row, ["barcode", "ean", "upc", "gtin"]);
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) return digits;
  return null;
}

function normalizeSourceKey(value: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const folded = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (folded === "alibaba") return "alibaba";
  if (folded === "aliexpress" || folded === "aliexpres") return "aliexpress";
  if (folded === "temu") return "temu";
  if (folded.startsWith("amazon")) return "amazon";
  if (folded.startsWith("ebay")) return "ebay";

  return trimmed.toLowerCase();
}

function canonicalizeSupplier(
  row: JsonRow,
  stats?: CanonicalizeDebugStats
): CanonicalProduct | null {
  const titleRaw = pickString(row, [
    "title",
    "product_title",
    "productTitle",
    "name",
    "product_name",
    "matched_title",
    "matchedTitle"
  ]);
  const sourceRaw = pickString(row, [
    "source",
    "supplier_key",
    "supplierKey",
    "marketplace",
    "marketplace_key",
    "marketplaceKey",
    "platform"
  ]);
  const sourceKey = normalizeSourceKey(sourceRaw);
  const productId = pickString(row, [
    "source_product_id",
    "sourceProductId",
    "supplier_product_id",
    "supplierProductId",
    "marketplace_listing_id",
    "marketplaceListingId",
    "listing_id",
    "listingId",
    "product_id",
    "productId",
    "external_id",
    "externalId",
    "id"
  ]);

  if (!titleRaw) {
    if (stats) stats.missingTitle += 1;
    return null;
  }
  if (!sourceKey) {
    if (stats) stats.missingSource += 1;
    return null;
  }
  if (!productId) {
    if (stats) stats.missingId += 1;
    return null;
  }

  const normalizedTitle = normalizeTitle(titleRaw);
  const tokens = tokensFromNormalized(normalizedTitle);

  if (stats) stats.canonicalized += 1;

  return {
    sourceKey,
    productId,
    title: titleRaw,
    titleRaw,
    normalizedTitle,
    tokens,
    price: pickNumber(row, [
      "price_min",
      "priceMin",
      "price_max",
      "priceMax",
      "supplier_price",
      "supplierPrice",
      "cost",
      "unit_price",
      "unitPrice",
      "price",
      "price_value",
      "priceValue"
    ]),
    currency: pickString(row, ["currency", "price_currency"]),
    barcode: extractBarcode(row),
    modelTokens: extractModelTokens(titleRaw),
    raw: row,
    ts: pickTimestampMs(row)
  };
}

function canonicalizeMarketplace(
  row: JsonRow,
  stats?: CanonicalizeDebugStats
): CanonicalProduct | null {
  const titleRaw = pickString(row, [
    "matched_title",
    "matchedTitle",
    "title",
    "listing_title",
    "listingTitle",
    "name",
    "product_title",
    "productTitle"
  ]);
  const sourceRaw = pickString(row, [
    "marketplace",
    "marketplace_key",
    "marketplaceKey",
    "source",
    "supplier_key",
    "supplierKey",
    "platform"
  ]);
  const sourceKey = normalizeSourceKey(sourceRaw);
  const productId = pickString(row, [
    "listing_id",
    "listingId",
    "marketplace_listing_id",
    "marketplaceListingId",
    "product_id",
    "productId",
    "supplier_product_id",
    "supplierProductId",
    "id"
  ]);

  if (!titleRaw) {
    if (stats) stats.missingTitle += 1;
    return null;
  }
  if (!sourceKey) {
    if (stats) stats.missingSource += 1;
    return null;
  }
  if (!productId) {
    if (stats) stats.missingId += 1;
    return null;
  }

  const normalizedTitle = normalizeTitle(titleRaw);
  const tokens = tokensFromNormalized(normalizedTitle);

  if (stats) stats.canonicalized += 1;

  return {
    sourceKey,
    productId,
    title: titleRaw,
    titleRaw,
    normalizedTitle,
    tokens,
    price: pickNumber(row, ["marketplace_price", "price", "current_price", "sale_price", "price_value"]),
    currency: pickString(row, ["currency", "price_currency"]),
    barcode: extractBarcode(row),
    modelTokens: extractModelTokens(titleRaw),
    raw: row,
    ts: pickTimestampMs(row)
  };
}

async function loadJsonRows(tableName: "products_raw" | "marketplace_prices", limit: number): Promise<JsonRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 5000));
  const orderColumn = tableName === "products_raw" ? "snapshot_ts" : "snapshot_ts";
  const query = sql.raw(
    `select row_to_json(t) as row from ${tableName} t order by ${orderColumn} desc nulls last limit ${safeLimit}`
  );
  const result = await db.execute(query);
  const rows = ((result as unknown as { rows?: Array<{ row: JsonRow }> }).rows ?? []).map((r) => r.row);
  return rows;
}

function dedupeCanonicalRows(rows: CanonicalProduct[]): CanonicalProduct[] {
  const seen = new Set<string>();
  const deduped: CanonicalProduct[] = [];

  for (const row of rows) {
    const key = `${row.sourceKey}:${row.productId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function buildMarketplaceTokenIndex(rows: CanonicalProduct[]): Map<string, CanonicalProduct[]> {
  const index = new Map<string, CanonicalProduct[]>();
  for (const row of rows) {
    for (const token of row.tokens) {
      if (token.length < 3) continue;
      const arr = index.get(token) ?? [];
      arr.push(row);
      index.set(token, arr);
    }
  }
  return index;
}

function chooseCandidateListings(
  supplier: CanonicalProduct,
  tokenIndex: Map<string, CanonicalProduct[]>,
  fallback: CanonicalProduct[]
): CanonicalProduct[] {
  const pool = new Map<string, CanonicalProduct>();
  const anchorTokens = supplier.tokens
    .filter((t) => t.length >= 3)
    .slice(0, 8);

  for (const token of anchorTokens) {
    const listings = tokenIndex.get(token) ?? [];
    for (const listing of listings) {
      pool.set(`${listing.sourceKey}:${listing.productId}`, listing);
    }
  }

  if (pool.size === 0) {
    for (const listing of fallback.slice(0, 250)) {
      pool.set(`${listing.sourceKey}:${listing.productId}`, listing);
    }
  }

  return Array.from(pool.values());
}

function priceSanity(
  supplierPrice: number | null,
  marketPrice: number | null
): { ok: boolean; score: number; ratio: number | null; reason: string | null } {
  if (supplierPrice == null || marketPrice == null || supplierPrice <= 0 || marketPrice <= 0) {
    return { ok: true, score: 0.5, ratio: null, reason: null };
  }

  const ratio = marketPrice / supplierPrice;

  if (ratio < 1.05) {
    return { ok: false, score: 0, ratio, reason: "market_below_supplier_floor" };
  }
  if (ratio < 1.15) {
    return { ok: true, score: 0.35, ratio, reason: "thin_margin_band" };
  }
  if (ratio < 1.3) {
    return { ok: true, score: 0.7, ratio, reason: "acceptable_margin_band" };
  }

  return { ok: true, score: 1, ratio, reason: "healthy_margin_band" };
}

function inferMatchType(params: {
  exactBarcode: boolean;
  sharedModelTokens: string[];
  fuzzy: number;
  overlap: number;
}): AcceptedMatch["matchType"] {
  if (params.exactBarcode) return "exact_barcode";
  if (params.sharedModelTokens.length > 0) return "exact_model";
  if (params.fuzzy >= 0.9) return "title_similarity";
  return "keyword_fuzzy";
}

function computeConfidence(params: {
  exactBarcode: boolean;
  sharedModelTokens: string[];
  fuzzy: number;
  overlap: number;
  supplierCoverage: number;
  listingCoverage: number;
  titleContained: boolean;
  priceScore: number;
}): number {
  if (params.exactBarcode) return 0.99;

  let score =
    params.overlap * 0.2 +
    params.fuzzy * 0.3 +
    params.supplierCoverage * 0.3 +
    params.listingCoverage * 0.1 +
    params.priceScore * 0.1;

  if (params.sharedModelTokens.length > 0) {
    score += 0.08;
  }

  if (params.supplierCoverage >= 0.999) {
    score += 0.05;
  }

  if (params.overlap >= 0.5 && params.fuzzy >= 0.6) {
    score += 0.04;
  }

  if (params.titleContained) {
    score += 0.08;
  }

  return clamp01(round4(score));
}

async function upsertMatch(match: AcceptedMatch): Promise<string> {
  const result = await db.execute(sql<{ id: string }>`
    INSERT INTO matches (
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      match_type,
      confidence,
      evidence,
      status,
      first_seen_ts,
      last_seen_ts
    )
    VALUES (
      ${match.supplierKey},
      ${match.supplierProductId},
      ${match.marketplaceKey},
      ${match.marketplaceListingId},
      ${match.matchType},
      ${match.confidence},
      ${JSON.stringify(match.evidence)}::jsonb,
      ${match.status},
      NOW(),
      NOW()
    )
    ON CONFLICT (
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id
    )
    DO UPDATE SET
      match_type = EXCLUDED.match_type,
      confidence = EXCLUDED.confidence,
      evidence = EXCLUDED.evidence,
      status = 'ACTIVE',
      last_seen_ts = NOW()
    RETURNING id
  `);

  const rows = (result as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
  return rows[0]?.id ?? "";
}

export async function matchSupplierProductsToMarketplaceListings(params?: {
  supplierLimit?: number;
  marketplaceLimit?: number;
  minConfidence?: number;
  forceReviewBelowThreshold?: boolean;
  debug?: boolean;
}): Promise<MatchProductsResult> {
  const supplierLimit = Math.max(1, Math.min(params?.supplierLimit ?? 250, 2000));
  const marketplaceLimit = Math.max(1, Math.min(params?.marketplaceLimit ?? 1000, 5000));
  const minConfidence = params?.minConfidence ?? 0.75;
  const forceReviewBelowThreshold = params?.forceReviewBelowThreshold ?? false;
  const debug = params?.debug ?? process.env.PRODUCT_MATCHER_DEBUG === "1";

  const supplierStats: CanonicalizeDebugStats = {
    missingTitle: 0,
    missingId: 0,
    missingSource: 0,
    canonicalized: 0
  };
  const marketplaceStats: CanonicalizeDebugStats = {
    missingTitle: 0,
    missingId: 0,
    missingSource: 0,
    canonicalized: 0
  };

  const rawSuppliers = await loadJsonRows("products_raw", supplierLimit * 4);
  const rawMarketplace = await loadJsonRows("marketplace_prices", marketplaceLimit * 4);

  const canonicalizedSuppliers = dedupeCanonicalRows(
    rawSuppliers
    .map((row) => canonicalizeSupplier(row, supplierStats))
    .filter((x): x is CanonicalProduct => Boolean(x))
    .sort((a, b) => b.ts - a.ts)
  );

  const suppliers = canonicalizedSuppliers
    .filter((x) => x.sourceKey === "alibaba" || x.sourceKey === "aliexpress" || x.sourceKey === "temu")
    .slice(0, supplierLimit);

  const supplierRejectedBySource = canonicalizedSuppliers.length - suppliers.length;

  const canonicalizedMarketplace = dedupeCanonicalRows(
    rawMarketplace
    .map((row) => canonicalizeMarketplace(row, marketplaceStats))
    .filter((x): x is CanonicalProduct => Boolean(x))
    .sort((a, b) => b.ts - a.ts)
  );

  const marketplaceListings = canonicalizedMarketplace
    .filter((x) => x.sourceKey === "amazon" || x.sourceKey === "ebay")
    .slice(0, marketplaceLimit);

  const marketplaceRejectedBySource = canonicalizedMarketplace.length - marketplaceListings.length;

  if (debug) {
    console.log(
      JSON.stringify(
        {
          productMatcherDebug: {
            rawRowsLoaded: {
              productsRaw: rawSuppliers.length,
              marketplacePrices: rawMarketplace.length
            },
            canonicalized: {
              suppliers: canonicalizedSuppliers.length,
              marketplaceListings: canonicalizedMarketplace.length
            },
            rejectedMissingFields: {
              suppliers: {
                missingTitle: supplierStats.missingTitle,
                missingId: supplierStats.missingId,
                missingSource: supplierStats.missingSource
              },
              marketplaceListings: {
                missingTitle: marketplaceStats.missingTitle,
                missingId: marketplaceStats.missingId,
                missingSource: marketplaceStats.missingSource
              }
            },
            rejectedBySourceFilter: {
              suppliers: supplierRejectedBySource,
              marketplaceListings: marketplaceRejectedBySource
            }
          }
        },
        null,
        2
      )
    );
  }

  const tokenIndex = buildMarketplaceTokenIndex(marketplaceListings);

  const accepted: AcceptedMatch[] = [];
  const topRejected: Array<Record<string, unknown>> = [];
  let evaluatedPairs = 0;

  for (const supplier of suppliers) {
    const candidateListings = chooseCandidateListings(supplier, tokenIndex, marketplaceListings);

    for (const listing of candidateListings) {
      if (listing.sourceKey !== "amazon" && listing.sourceKey !== "ebay") {
        continue;
      }

      const overlap = round4(tokenOverlapScore(supplier.tokens, listing.tokens));
      if (overlap < 0.2) continue;

      const fuzzy = round4(diceCoefficient(supplier.normalizedTitle, listing.normalizedTitle));
      if (fuzzy < 0.45 && overlap < 0.45) continue;

      const price = priceSanity(supplier.price, listing.price);
      if (!price.ok) continue;

      const shared = sharedTokens(supplier.tokens, listing.tokens);
      const supplierCoverage = round4(tokenCoverageScore(supplier.tokens, listing.tokens));
      const listingCoverage = round4(tokenCoverageScore(listing.tokens, supplier.tokens));
      const titleContained =
        supplier.normalizedTitle.includes(listing.normalizedTitle) ||
        listing.normalizedTitle.includes(supplier.normalizedTitle);
      const sharedModelTokens = supplier.modelTokens.filter((t) => listing.modelTokens.includes(t));
      const exactBarcode =
        Boolean(supplier.barcode) &&
        Boolean(listing.barcode) &&
        supplier.barcode === listing.barcode;

      const matchType = inferMatchType({
        exactBarcode,
        sharedModelTokens,
        fuzzy,
        overlap
      });

      const confidence = computeConfidence({
        exactBarcode,
        sharedModelTokens,
        fuzzy,
        overlap,
        supplierCoverage,
        listingCoverage,
        titleContained,
        priceScore: price.score
      });

      evaluatedPairs += 1;

      if (confidence < minConfidence && !forceReviewBelowThreshold) {
        if (debug) {
          topRejected.push({
            supplierKey: supplier.sourceKey,
            supplierProductId: supplier.productId,
            supplierTitle: supplier.titleRaw,
            marketplaceKey: listing.sourceKey,
            marketplaceListingId: listing.productId,
            marketplaceTitle: listing.titleRaw,
            confidence,
            overlap,
            fuzzy,
            supplierCoverage,
            listingCoverage,
            titleContained,
            priceRatio: price.ratio,
            priceBand: price.reason,
          });
          topRejected.sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0));
          if (topRejected.length > 10) topRejected.length = 10;
        }
        continue;
      }

      const evidence = {
        supplierTitle: supplier.titleRaw,
        marketplaceTitle: listing.titleRaw,
        normalizedSupplierTitle: supplier.normalizedTitle,
        normalizedMarketplaceTitle: listing.normalizedTitle,
        sharedTokens: shared,
        tokenOverlapScore: overlap,
        supplierCoverageScore: supplierCoverage,
        listingCoverageScore: listingCoverage,
        fuzzyTitleSimilarity: fuzzy,
        titleContained,
        supplierPrice: supplier.price,
        marketplacePrice: listing.price,
        priceRatio: price.ratio,
        priceBand: price.reason,
        exactBarcode,
        sharedModelTokens,
        supplierCurrency: supplier.currency,
        marketplaceCurrency: listing.currency
      };

      const match: AcceptedMatch = {
        matchId: "",
        supplierKey: supplier.sourceKey,
        supplierProductId: supplier.productId,
        marketplaceKey: listing.sourceKey,
        marketplaceListingId: listing.productId,
        matchType,
        confidence,
        evidence,
        status: "ACTIVE"
      };

      const matchId = await upsertMatch(match);
      match.matchId = matchId;
      accepted.push(match);
    }
  }

  return {
    scannedSuppliers: suppliers.length,
    scannedMarketplaceListings: marketplaceListings.length,
    evaluatedPairs,
    acceptedCount: accepted.length,
    accepted,
    debugTopRejected: debug ? topRejected : undefined,
  };
}
