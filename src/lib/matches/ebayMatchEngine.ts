import { db } from "@/lib/db";
import { productsRaw, marketplacePrices, matches } from "@/lib/db/schema";
import {
  evaluateMatchAcceptance,
  evaluateProductPipelinePolicy,
  normalizeSupplierQuality,
} from "@/lib/products/pipelinePolicy";
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

const MISMATCH_PHRASES = [
  "pet hair",
  "motorized brush",
  "office",
  "air pump",
];

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

function overlapCount(a: string, b: string): number {
  const aa = new Set(tokenize(a));
  const bb = new Set(tokenize(b));

  let intersection = 0;
  for (const x of aa) {
    if (bb.has(x)) intersection++;
  }

  return intersection;
}

function containsPhrase(text: string, phrase: string): boolean {
  return normalizeText(text).includes(normalizeText(phrase));
}

function hasSemanticMismatch(supplierTitle: string, marketplaceTitle: string): string | null {
  for (const phrase of MISMATCH_PHRASES) {
    if (containsPhrase(marketplaceTitle, phrase) && !containsPhrase(supplierTitle, phrase)) {
      return phrase;
    }
  }
  return null;
}

function computeConfidence(
  supplierTitle: string,
  marketplaceTitle: string,
  marketplaceScore?: string | null
) {
  const rescored = jaccardSimilarity(supplierTitle, marketplaceTitle);
  const overlap = overlapCount(supplierTitle, marketplaceTitle);
  const rawScore = marketplaceScore != null ? Number(marketplaceScore) : 0;

  let confidence = (0.7 * rawScore) + (0.3 * rescored);

  if (overlap >= 2) confidence += 0.05;
  if (overlap >= 3) confidence += 0.05;

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    rawScore: Number(rawScore.toFixed(4)),
    rescored: Number(rescored.toFixed(4)),
    overlap,
    confidence: Number(confidence.toFixed(4)),
  };
}

function detectMatchType(score: number): string {
  if (score >= 0.75) return "strong_title_similarity";
  if (score >= 0.5) return "title_similarity";
  return "fallback_title_similarity";
}

type CandidateRow = {
  productRawId: string;
  supplierKey: string | null;
  supplierProductId: string | null;
  supplierTitle: string | null;
  supplierImages: unknown;
  supplierPrice: string | null;
  supplierRawPayload: unknown;
  marketplaceKey: string | null;
  marketplaceListingId: string | null;
  matchedTitle: string | null;
  finalMatchScore: string | null;
  marketplacePrice: string | null;
};

type RankedCandidate = CandidateRow & {
  rawScore: number;
  rescored: number;
  overlap: number;
  confidence: number;
  mismatchPhrase: string | null;
};

function chooseBestCandidate(rows: CandidateRow[]): RankedCandidate | null {
  const minConfidence = Number(process.env.MATCH_MIN_CONFIDENCE || "0.65");
  const minMarketplaceScore = Number(process.env.MATCH_MIN_MARKETPLACE_SCORE || "0.42");
  const minOverlap = Number(process.env.MATCH_MIN_OVERLAP || "2");

  let best: RankedCandidate | null = null;

  for (const row of rows) {
    const supplierTitle = String(row.supplierTitle || "");
    const matchedTitle = String(row.matchedTitle || "");

    if (!supplierTitle || !matchedTitle || !row.marketplaceListingId || !row.marketplaceKey) {
      continue;
    }

    const mismatchPhrase = hasSemanticMismatch(supplierTitle, matchedTitle);
    const scored = computeConfidence(supplierTitle, matchedTitle, row.finalMatchScore);

    if (mismatchPhrase) continue;
    if (scored.rawScore < minMarketplaceScore) continue;
    if (scored.overlap < minOverlap) continue;
    if (scored.confidence < minConfidence) continue;

    const supplierImages = Array.isArray(row.supplierImages)
      ? row.supplierImages.filter((value): value is string => typeof value === "string")
      : [];
    const pipeline = evaluateProductPipelinePolicy({
      title: supplierTitle,
      marketplaceTitle: matchedTitle,
      supplierTitle,
      imageUrl: supplierImages[0] ?? null,
      additionalImageCount: Math.max(0, supplierImages.length - 1),
      supplierQuality:
        row.supplierRawPayload &&
        typeof row.supplierRawPayload === "object" &&
        !Array.isArray(row.supplierRawPayload)
          ? normalizeSupplierQuality(
              String((row.supplierRawPayload as Record<string, unknown>).snapshotQuality ?? "")
            )
          : null,
      telemetrySignals:
        row.supplierRawPayload &&
        typeof row.supplierRawPayload === "object" &&
        !Array.isArray(row.supplierRawPayload) &&
        Array.isArray((row.supplierRawPayload as Record<string, unknown>).telemetrySignals)
          ? ((row.supplierRawPayload as Record<string, unknown>).telemetrySignals as string[])
          : [],
      supplierPrice: row.supplierPrice != null ? Number(row.supplierPrice) : null,
      marketplacePrice: row.marketplacePrice != null ? Number(row.marketplacePrice) : null,
      matchConfidence: scored.confidence,
    });
    const supplierPrice = row.supplierPrice != null ? Number(row.supplierPrice) : null;
    const marketplacePrice = row.marketplacePrice != null ? Number(row.marketplacePrice) : null;
    const priceAlignmentStrong =
      supplierPrice != null &&
      marketplacePrice != null &&
      supplierPrice > 0 &&
      marketplacePrice >= supplierPrice * 1.5 &&
      marketplacePrice <= supplierPrice * 5;
    const matchDecision = evaluateMatchAcceptance({
      confidence: scored.confidence,
      titleSimilarityStrong: scored.rescored >= 0.68 || scored.overlap >= 3,
      priceAlignmentStrong,
      strongMedia: pipeline.strongMedia,
      simpleLowRisk: pipeline.simpleLowRisk,
    });

    if (!matchDecision.accepted) continue;

    const candidate: RankedCandidate = {
      ...row,
      ...scored,
      mismatchPhrase,
    };

    if (!best) {
      best = candidate;
      continue;
    }

    if (candidate.confidence > best.confidence) {
      best = candidate;
      continue;
    }

    if (candidate.confidence === best.confidence && candidate.rawScore > best.rawScore) {
      best = candidate;
      continue;
    }
  }

  return best;
}

export async function runEbayMatches(input?: {
  limit?: number;
  productRawId?: string;
}) {
  const limit = Number(input?.limit ?? 50);

  const rows = input?.productRawId
    ? await db
        .select({
          productRawId: productsRaw.id,
          supplierKey: productsRaw.supplierKey,
          supplierProductId: productsRaw.supplierProductId,
          supplierTitle: productsRaw.title,
          supplierImages: productsRaw.images,
          supplierPrice: productsRaw.priceMin,
          supplierRawPayload: productsRaw.rawPayload,
          marketplaceKey: marketplacePrices.marketplaceKey,
          marketplaceListingId: marketplacePrices.marketplaceListingId,
          matchedTitle: marketplacePrices.matchedTitle,
          finalMatchScore: marketplacePrices.finalMatchScore,
          marketplacePrice: marketplacePrices.price,
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
          supplierImages: productsRaw.images,
          supplierPrice: productsRaw.priceMin,
          supplierRawPayload: productsRaw.rawPayload,
          marketplaceKey: marketplacePrices.marketplaceKey,
          marketplaceListingId: marketplacePrices.marketplaceListingId,
          matchedTitle: marketplacePrices.matchedTitle,
          finalMatchScore: marketplacePrices.finalMatchScore,
          marketplacePrice: marketplacePrices.price,
        })
        .from(marketplacePrices)
        .innerJoin(productsRaw, eq(marketplacePrices.productRawId, productsRaw.id))
        .where(eq(marketplacePrices.marketplaceKey, "ebay"))
        .orderBy(desc(marketplacePrices.snapshotTs))
        .limit(limit);

  const byProduct = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    const key = String(row.productRawId);
    const existing = byProduct.get(key) || [];
    existing.push(row);
    byProduct.set(key, existing);
  }

  let scanned = 0;
  let inserted = 0;
  let updated = 0;
  let skippedNoQualifiedCandidate = 0;

  const minConfidence = Number(process.env.MATCH_MIN_CONFIDENCE || "0.45");
  const minMarketplaceScore = Number(process.env.MATCH_MIN_MARKETPLACE_SCORE || "0.42");
  const minOverlap = Number(process.env.MATCH_MIN_OVERLAP || "2");

  for (const [, productRows] of byProduct) {
    scanned++;

    const best = chooseBestCandidate(productRows);
    const first = productRows[0];

    if (!best) {
      if (first?.supplierKey && first?.supplierProductId) {
        await db
          .update(matches)
          .set({
            status: "INACTIVE",
            lastSeenTs: new Date(),
          })
          .where(
            and(
              eq(matches.supplierKey, String(first.supplierKey)),
              eq(matches.supplierProductId, String(first.supplierProductId)),
              eq(matches.marketplaceKey, "ebay"),
            )
          );
      }

      skippedNoQualifiedCandidate++;
      continue;
    }

    const supplierKey = String(best.supplierKey || "").toLowerCase();
    const supplierProductId = String(best.supplierProductId || "");
    const matchedTitle = String(best.matchedTitle || "");
    const supplierImages = Array.isArray(best.supplierImages)
      ? best.supplierImages.filter((value): value is string => typeof value === "string")
      : [];
    const pipeline = evaluateProductPipelinePolicy({
      title: String(best.supplierTitle || ""),
      marketplaceTitle: matchedTitle,
      supplierTitle: String(best.supplierTitle || ""),
      imageUrl: supplierImages[0] ?? null,
      additionalImageCount: Math.max(0, supplierImages.length - 1),
      supplierQuality:
        best.supplierRawPayload &&
        typeof best.supplierRawPayload === "object" &&
        !Array.isArray(best.supplierRawPayload)
          ? normalizeSupplierQuality(
              String((best.supplierRawPayload as Record<string, unknown>).snapshotQuality ?? "")
            )
          : null,
      telemetrySignals:
        best.supplierRawPayload &&
        typeof best.supplierRawPayload === "object" &&
        !Array.isArray(best.supplierRawPayload) &&
        Array.isArray((best.supplierRawPayload as Record<string, unknown>).telemetrySignals)
          ? ((best.supplierRawPayload as Record<string, unknown>).telemetrySignals as string[])
          : [],
      supplierPrice: best.supplierPrice != null ? Number(best.supplierPrice) : null,
      marketplacePrice: best.marketplacePrice != null ? Number(best.marketplacePrice) : null,
      matchConfidence: best.confidence,
    });
    const priceAlignmentStrong =
      best.supplierPrice != null &&
      best.marketplacePrice != null &&
      Number(best.supplierPrice) > 0 &&
      Number(best.marketplacePrice) >= Number(best.supplierPrice) * 1.5 &&
      Number(best.marketplacePrice) <= Number(best.supplierPrice) * 5;
    const matchDecision = evaluateMatchAcceptance({
      confidence: best.confidence,
      titleSimilarityStrong: best.rescored >= 0.68 || best.overlap >= 3,
      priceAlignmentStrong,
      strongMedia: pipeline.strongMedia,
      simpleLowRisk: pipeline.simpleLowRisk,
    });

    const evidence = {
      supplierTitle: String(best.supplierTitle || ""),
      matchedTitle,
      marketplaceKey: best.marketplaceKey,
      marketplaceListingId: best.marketplaceListingId,
      marketplacePriceScore: best.rawScore,
      recomputedTitleSimilarity: best.rescored,
      overlap: best.overlap,
      acceptedConfidence: best.confidence,
      minConfidence,
      minMarketplaceScore,
      minOverlap,
      selectionMode: "best_per_supplier_product",
      pipelinePolicy: pipeline,
      matchDecision,
    };

    await db
      .update(matches)
      .set({
        status: "INACTIVE",
        lastSeenTs: new Date(),
      })
      .where(
        and(
          eq(matches.supplierKey, supplierKey),
          eq(matches.supplierProductId, supplierProductId),
          eq(matches.marketplaceKey, "ebay"),
        )
      );

    const existing = await db
      .select({ id: matches.id })
      .from(matches)
      .where(
        and(
          eq(matches.supplierKey, supplierKey),
          eq(matches.supplierProductId, supplierProductId),
          eq(matches.marketplaceKey, "ebay"),
          eq(matches.marketplaceListingId, String(best.marketplaceListingId)),
        )
      )
      .limit(1);

    if (existing.length) {
      await db
        .update(matches)
        .set({
          matchType: detectMatchType(best.confidence),
          confidence: String(best.confidence),
          evidence,
          status: "ACTIVE",
          lastSeenTs: new Date(),
        })
        .where(eq(matches.id, existing[0].id));

      updated++;
      continue;
    }

    await db.insert(matches).values({
      supplierKey,
      supplierProductId,
      marketplaceKey: "ebay",
      marketplaceListingId: String(best.marketplaceListingId),
      matchType: detectMatchType(best.confidence),
      confidence: String(best.confidence),
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
    skippedNoQualifiedCandidate,
    minConfidence,
    minMarketplaceScore,
    minOverlap,
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
