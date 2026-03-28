import { db } from "@/lib/db";
import { productsRaw, marketplacePrices } from "@/lib/db/schema";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import {
  getMatchRoutingStatus,
  PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN,
  PRODUCT_PIPELINE_MATCH_PREFERRED_MIN,
} from "@/lib/products/pipelinePolicy";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

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
  "sample",
  "samples",
  "temu",
  "alibaba",
  "aliexpress",
  "amazon",
  "ebay",
  "portable",
  "wireless",
  "cordless",
  "mini",
  "small",
  "powerful",
  "rechargeable",
  "cleaner",
]);

function normalize(text: string) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string) {
  return normalize(text)
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length > 2 && !STOPWORDS.has(x));
}

function uniqueTokens(text: string) {
  return Array.from(new Set(tokenize(text)));
}

function jaccard(a: string, b: string) {
  const ta = new Set(uniqueTokens(a));
  const tb = new Set(uniqueTokens(b));

  if (!ta.size || !tb.size) return 0;

  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }

  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

function overlapCount(a: string, b: string) {
  const ta = new Set(uniqueTokens(a));
  const tb = new Set(uniqueTokens(b));

  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }

  return intersection;
}

function extractBrandToken(title: string): string | null {
  const tokens = uniqueTokens(title);
  if (!tokens.length) return null;
  const knownBrands = new Set([
    "apple",
    "samsung",
    "sony",
    "xiaomi",
    "nike",
    "adidas",
    "puma",
    "anker",
    "lenovo",
    "dell",
    "hp",
    "canon",
    "lego",
  ]);
  for (const token of tokens) {
    if (knownBrands.has(token)) return token;
  }
  return null;
}

function broadTitlePenalty(supplierTitle: string, marketplaceTitle: string) {
  const supplierTokens = uniqueTokens(supplierTitle);
  const marketTokens = uniqueTokens(marketplaceTitle);

  if (!supplierTokens.length || !marketTokens.length) return 0.2;
  if (supplierTokens.length === 1) return 0.2;
  if (supplierTokens.length === 2 && marketTokens.length > 6) return 0.1;

  return 0;
}

function priceMismatchPenalty(supplierPrice: number | null, marketplacePrice: number | null): number {
  if (supplierPrice == null || marketplacePrice == null || supplierPrice <= 0 || marketplacePrice <= 0) return 0;
  const ratio = marketplacePrice / supplierPrice;
  if (!Number.isFinite(ratio)) return 0;
  if (ratio > 6 || ratio < 0.5) return 0.18;
  if (ratio > 4.5 || ratio < 0.7) return 0.12;
  if (ratio > 3.5 || ratio < 0.8) return 0.08;
  return 0;
}

export function computeConfidence(input: {
  supplierTitle: string;
  marketplaceTitle: string;
  marketplaceScore?: string | null;
  supplierPrice?: number | null;
  marketplacePrice?: number | null;
}) {
  const { supplierTitle, marketplaceTitle, marketplaceScore, supplierPrice, marketplacePrice } = input;
  const titleScore = jaccard(supplierTitle, marketplaceTitle);
  const overlap = overlapCount(supplierTitle, marketplaceTitle);
  const externalScore = marketplaceScore != null ? Number(marketplaceScore) : 0;
  const supplierBrand = extractBrandToken(supplierTitle);
  const marketplaceBrand = extractBrandToken(marketplaceTitle);
  const brandMismatchPenalty =
    supplierBrand && marketplaceBrand && supplierBrand !== marketplaceBrand ? 0.32 : 0;
  const weakOverlapPenalty = overlap <= 1 ? 0.18 : overlap === 2 ? 0.06 : 0;
  const largePriceMismatchPenalty = priceMismatchPenalty(supplierPrice ?? null, marketplacePrice ?? null);

  let confidence = Math.max(titleScore, externalScore);

  if (overlap >= 2) confidence += 0.08;
  if (overlap >= 3) confidence += 0.08;

  confidence -= broadTitlePenalty(supplierTitle, marketplaceTitle);
  confidence -= weakOverlapPenalty;
  confidence -= brandMismatchPenalty;
  confidence -= largePriceMismatchPenalty;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    confidence: Number(confidence.toFixed(4)),
    titleScore: Number(titleScore.toFixed(4)),
    overlap,
    penalties: {
      brandMismatchPenalty,
      weakOverlapPenalty,
      largePriceMismatchPenalty,
    },
    brands: {
      supplier: supplierBrand,
      marketplace: marketplaceBrand,
    },
  };
}

function detectMatchType(confidence: number) {
  if (confidence >= PRODUCT_PIPELINE_MATCH_PREFERRED_MIN) return "strong_title_similarity";
  if (confidence >= PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN) return "title_similarity";
  return "fallback_title_similarity";
}

export async function matchSupplierProductsToMarketplaceListings(input?: {
  limit?: number;
  productRawId?: string;
}) {
  const limit = Number(input?.limit ?? 50);
  const minConfidence = Number(process.env.MATCH_MIN_CONFIDENCE || "0.30");

  const rows = input?.productRawId
    ? await db
        .select({
          productRawId: productsRaw.id,
          supplierKey: productsRaw.supplierKey,
          supplierProductId: productsRaw.supplierProductId,
          supplierTitle: productsRaw.title,
          marketplaceKey: marketplacePrices.marketplaceKey,
          marketplaceListingId: marketplacePrices.marketplaceListingId,
          matchedTitle: marketplacePrices.matchedTitle,
          finalMatchScore: marketplacePrices.finalMatchScore,
          supplierPrice: productsRaw.priceMin,
          marketplacePrice: marketplacePrices.price,
        })
        .from(marketplacePrices)
        .innerJoin(productsRaw, eq(marketplacePrices.productRawId, productsRaw.id))
        .where(eq(marketplacePrices.productRawId, input.productRawId))
    : await db
        .select({
          productRawId: productsRaw.id,
          supplierKey: productsRaw.supplierKey,
          supplierProductId: productsRaw.supplierProductId,
          supplierTitle: productsRaw.title,
          marketplaceKey: marketplacePrices.marketplaceKey,
          marketplaceListingId: marketplacePrices.marketplaceListingId,
          matchedTitle: marketplacePrices.matchedTitle,
          finalMatchScore: marketplacePrices.finalMatchScore,
          supplierPrice: productsRaw.priceMin,
          marketplacePrice: marketplacePrices.price,
        })
        .from(marketplacePrices)
        .innerJoin(productsRaw, eq(marketplacePrices.productRawId, productsRaw.id))
        .orderBy(desc(marketplacePrices.snapshotTs))
        .limit(limit);

  let insertedOrUpdated = 0;
  let skipped = 0;

  for (const row of rows) {
    const supplierTitle = String(row.supplierTitle || "");
    const marketplaceTitle = String(row.matchedTitle || "");
    const supplierKey = String(row.supplierKey || "").toLowerCase();
    const marketplaceKey = normalizeMarketplaceKey(String(row.marketplaceKey || ""));

    const { confidence, titleScore, overlap, penalties, brands } = computeConfidence({
      supplierTitle,
      marketplaceTitle,
      marketplaceScore: row.finalMatchScore,
      supplierPrice: row.supplierPrice == null ? null : Number(row.supplierPrice),
      marketplacePrice: row.marketplacePrice == null ? null : Number(row.marketplacePrice),
    });

    if (confidence < minConfidence || overlap < 1) {
      skipped++;
      continue;
    }

    const evidence = {
      supplierTitle,
      marketplaceTitle,
      normalizedSupplierTokens: uniqueTokens(supplierTitle),
      normalizedMarketplaceTokens: uniqueTokens(marketplaceTitle),
      overlap,
      recomputedTitleSimilarity: titleScore,
      marketplaceScore: row.finalMatchScore != null ? Number(row.finalMatchScore) : null,
      supplierPrice: row.supplierPrice == null ? null : Number(row.supplierPrice),
      marketplacePrice: row.marketplacePrice == null ? null : Number(row.marketplacePrice),
      penalties,
      brands,
    };

    await db.execute(sql`
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
      ) VALUES (
        ${supplierKey},
        ${row.supplierProductId},
        ${marketplaceKey},
        ${row.marketplaceListingId},
        ${detectMatchType(confidence)},
        ${String(confidence)},
        ${JSON.stringify(evidence)}::jsonb,
        ${getMatchRoutingStatus(confidence)},
        NOW(),
        NOW()
      )
      ON CONFLICT (supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id)
      DO UPDATE SET
        match_type = EXCLUDED.match_type,
        confidence = EXCLUDED.confidence,
        evidence = EXCLUDED.evidence,
        status = ${getMatchRoutingStatus(confidence)},
        last_seen_ts = NOW()
    `);

    insertedOrUpdated++;
  }

  return {
    ok: true,
    scanned: rows.length,
    insertedOrUpdated,
    skipped,
    minConfidence,
  };
}
