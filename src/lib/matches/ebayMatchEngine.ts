import { db } from "@/lib/db";
import { productsRaw, marketplacePrices, matches } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

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

function normalizeText(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-/.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[\s\-/.]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1 && !STOPWORDS.has(x));
}

function jaccardSimilarity(a: string, b: string): number {
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

function detectMatchType(score: number): string {
  if (score >= 0.75) return "strong_title_similarity";
  if (score >= 0.5) return "title_similarity";
  return "fallback_title_similarity";
}

export async function runEbayMatches(input?: {
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
        .where(
          and(
            eq(marketplacePrices.marketplaceKey, "ebay"),
            eq(marketplacePrices.productRawId, input.productRawId),
          )
        )
        .orderBy(desc(marketplacePrices.snapshotTs))
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
        .where(eq(marketplacePrices.marketplaceKey, "ebay"))
        .orderBy(desc(marketplacePrices.snapshotTs))
        .limit(limit);

  let inserted = 0;
  let updated = 0;
  let scanned = 0;

  for (const row of rows) {
    scanned++;

    const supplierTitle = String(row.supplierTitle || "");
    const matchedTitle = String(row.matchedTitle || "");
    const rescored = jaccardSimilarity(supplierTitle, matchedTitle);

    const rawScore =
      row.finalMatchScore != null ? Number(row.finalMatchScore) : rescored;

    const confidence = Math.max(rawScore, rescored);

    if (confidence < minConfidence) {
      continue;
    }

    const evidence = {
      supplierTitle,
      matchedTitle,
      marketplaceKey: row.marketplaceKey,
      marketplaceListingId: row.marketplaceListingId,
      marketplacePriceScore: row.finalMatchScore != null ? Number(row.finalMatchScore) : null,
      recomputedTitleSimilarity: Number(rescored.toFixed(4)),
      acceptedConfidence: Number(confidence.toFixed(4)),
    };

    const existing = await db
      .select({ id: matches.id })
      .from(matches)
      .where(
        and(
          eq(matches.supplierKey, row.supplierKey),
          eq(matches.supplierProductId, row.supplierProductId),
          eq(matches.marketplaceKey, "ebay"),
          eq(matches.marketplaceListingId, row.marketplaceListingId),
        )
      )
      .limit(1);

    if (existing.length) {
      await db
        .update(matches)
        .set({
          matchType: detectMatchType(confidence),
          confidence: String(Number(confidence.toFixed(4))),
          evidence,
          status: "ACTIVE",
          lastSeenTs: new Date(),
        })
        .where(eq(matches.id, existing[0].id));

      updated++;
      continue;
    }

    await db.insert(matches).values({
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      marketplaceKey: "ebay",
      marketplaceListingId: row.marketplaceListingId,
      matchType: detectMatchType(confidence),
      confidence: String(Number(confidence.toFixed(4))),
      evidence,
      status: "ACTIVE",
      firstSeenTs: new Date(),
      lastSeenTs: new Date(),
    });

    inserted++;
  }

  return {
    ok: true,
    scanned,
    inserted,
    updated,
    minConfidence,
  };
}

export async function getRecentMatches(limit = 20) {
  const result = await db.execute(sql`
    SELECT
      id,
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      match_type,
      confidence,
      status,
      first_seen_ts,
      last_seen_ts
    FROM matches
    ORDER BY last_seen_ts DESC
    LIMIT ${limit}
  `);

  return result.rows;
}
