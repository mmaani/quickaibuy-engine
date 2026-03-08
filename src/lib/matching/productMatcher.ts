import { db } from "@/lib/db";
import { productsRaw, marketplacePrices } from "@/lib/db/schema";
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

function broadTitlePenalty(supplierTitle: string, marketplaceTitle: string) {
  const supplierTokens = uniqueTokens(supplierTitle);
  const marketTokens = uniqueTokens(marketplaceTitle);

  if (!supplierTokens.length || !marketTokens.length) return 0.2;
  if (supplierTokens.length === 1) return 0.2;
  if (supplierTokens.length === 2 && marketTokens.length > 6) return 0.1;

  return 0;
}

function computeConfidence(supplierTitle: string, marketplaceTitle: string, marketplaceScore?: string | null) {
  const titleScore = jaccard(supplierTitle, marketplaceTitle);
  const overlap = overlapCount(supplierTitle, marketplaceTitle);
  const externalScore = marketplaceScore != null ? Number(marketplaceScore) : 0;

  let confidence = Math.max(titleScore, externalScore);

  if (overlap >= 2) confidence += 0.08;
  if (overlap >= 3) confidence += 0.08;

  confidence -= broadTitlePenalty(supplierTitle, marketplaceTitle);
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    confidence: Number(confidence.toFixed(4)),
    titleScore: Number(titleScore.toFixed(4)),
    overlap,
  };
}

function detectMatchType(confidence: number) {
  if (confidence >= 0.75) return "strong_title_similarity";
  if (confidence >= 0.5) return "title_similarity";
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

    const { confidence, titleScore, overlap } = computeConfidence(
      supplierTitle,
      marketplaceTitle,
      row.finalMatchScore
    );

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
        ${row.marketplaceKey},
        ${row.marketplaceListingId},
        ${detectMatchType(confidence)},
        ${String(confidence)},
        ${JSON.stringify(evidence)}::jsonb,
        'ACTIVE',
        NOW(),
        NOW()
      )
      ON CONFLICT (supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id)
      DO UPDATE SET
        match_type = EXCLUDED.match_type,
        confidence = EXCLUDED.confidence,
        evidence = EXCLUDED.evidence,
        status = 'ACTIVE',
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
