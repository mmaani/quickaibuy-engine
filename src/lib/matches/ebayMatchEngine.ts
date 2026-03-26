import { db } from "@/lib/db";
import { productsRaw, marketplacePrices, matches } from "@/lib/db/schema";
import {
  normalizeSupplierQuality,
  evaluateProductPipelinePolicy,
  getMatchRoutingStatus,
  PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN,
  PRODUCT_PIPELINE_MATCH_PREFERRED_MIN,
} from "@/lib/products/pipelinePolicy";
import { and, asc, desc, eq, sql } from "drizzle-orm";

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

const BRANDED_TERMS = ["apple", "samsung", "nike", "sony", "lg", "xiaomi", "dyson", "tesla"];
const GENERIC_TERMS = ["accessory", "gadget", "item", "tool", "device", "product"];

type MatchStatus = "ACTIVE" | "MANUAL_REVIEW" | "REJECTED";

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
  for (const x of aa) if (bb.has(x)) intersection++;

  const union = new Set([...aa, ...bb]).size;
  return union === 0 ? 0 : intersection / union;
}

function tokenOverlapRatio(a: string, b: string): number {
  const aa = new Set(tokenize(a));
  const bb = new Set(tokenize(b));
  if (!aa.size || !bb.size) return 0;

  let intersection = 0;
  for (const x of aa) if (bb.has(x)) intersection++;

  return intersection / Math.min(aa.size, bb.size);
}

function bigramDiceSimilarity(a: string, b: string): number {
  const left = normalizeText(a).replace(/\s+/g, "");
  const right = normalizeText(b).replace(/\s+/g, "");
  if (left.length < 2 || right.length < 2) return 0;

  const leftBigrams = new Map<string, number>();
  for (let i = 0; i < left.length - 1; i++) {
    const key = left.slice(i, i + 2);
    leftBigrams.set(key, (leftBigrams.get(key) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < right.length - 1; i++) {
    const key = right.slice(i, i + 2);
    const available = leftBigrams.get(key) ?? 0;
    if (available > 0) {
      leftBigrams.set(key, available - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (left.length - 1 + (right.length - 1));
}

function inferProductType(title: string): string {
  const normalized = normalizeText(title);
  if (/(lamp|light|night light|led)/.test(normalized)) return "lighting";
  if (/(organizer|storage|holder|rack)/.test(normalized)) return "organizer";
  if (/(fan|cooling)/.test(normalized)) return "fan";
  if (/(charger|adapter|battery|usb)/.test(normalized)) return "electronics";
  if (/(car|automotive|vehicle)/.test(normalized)) return "auto";
  return "general";
}

function extractAttributeTokens(rawPayload: unknown, title: string): Set<string> {
  const out = new Set<string>();
  const textTokens = tokenize(title);
  for (const t of textTokens) out.add(t);

  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return out;
  const payload = rawPayload as Record<string, unknown>;

  const possible = [
    payload.brand,
    payload.type,
    payload.model,
    payload.material,
    payload.color,
    payload.voltage,
    payload.power,
    payload.connectivity,
    payload.room,
    payload.use_case,
    payload.country_of_origin,
  ];

  for (const value of possible) {
    const asText = String(value ?? "").trim();
    if (!asText) continue;
    for (const token of tokenize(asText)) out.add(token);
  }

  return out;
}

function attributeOverlapScore(supplierRawPayload: unknown, supplierTitle: string, marketplaceTitle: string): number {
  const supplierAttrs = extractAttributeTokens(supplierRawPayload, supplierTitle);
  const marketAttrs = extractAttributeTokens(null, marketplaceTitle);
  if (!supplierAttrs.size || !marketAttrs.size) return 0;

  let overlap = 0;
  for (const token of supplierAttrs) if (marketAttrs.has(token)) overlap++;
  return overlap / Math.min(supplierAttrs.size, marketAttrs.size);
}

function priceAlignmentScore(supplierPrice: string | null, marketplacePrice: string | null): number {
  const supplier = supplierPrice != null ? Number(supplierPrice) : NaN;
  const market = marketplacePrice != null ? Number(marketplacePrice) : NaN;
  if (!Number.isFinite(supplier) || !Number.isFinite(market) || supplier <= 0) return 0;

  const ratio = market / supplier;
  if (ratio >= 1.4 && ratio <= 5) return 1;
  if (ratio >= 1.2 && ratio <= 6) return 0.65;
  if (ratio >= 1.0 && ratio <= 7) return 0.35;
  return 0;
}

function brandedMarketplacePenalty(supplierTitle: string, marketplaceTitle: string): number {
  const supplier = normalizeText(supplierTitle);
  const market = normalizeText(marketplaceTitle);
  const supplierGeneric = GENERIC_TERMS.some((term) => supplier.includes(term)) || tokenize(supplier).length <= 3;
  const marketplaceBranded = BRANDED_TERMS.some((brand) => market.includes(brand));
  return supplierGeneric && marketplaceBranded ? 0.12 : 0;
}

type MatchQuality = {
  lexicalSimilarity: number;
  fuzzySimilarity: number;
  tokenOverlap: number;
  marketplaceScore: number;
  priceAlignment: number;
  productTypeAlignment: number;
  attributeOverlap: number;
  penalties: string[];
  confidence: number;
};

function evaluateMatchQuality(row: CandidateRow): MatchQuality {
  const supplierTitle = String(row.supplierTitle ?? "");
  const marketplaceTitle = String(row.matchedTitle ?? "");

  const lexicalSimilarity = jaccardSimilarity(supplierTitle, marketplaceTitle);
  const fuzzySimilarity = bigramDiceSimilarity(supplierTitle, marketplaceTitle);
  const tokenOverlap = tokenOverlapRatio(supplierTitle, marketplaceTitle);
  const marketplaceScore = Math.max(0, Math.min(1, Number(row.finalMatchScore ?? 0) || 0));
  const priceAlignment = priceAlignmentScore(row.supplierPrice, row.marketplacePrice);
  const productTypeAlignment =
    inferProductType(supplierTitle) === inferProductType(marketplaceTitle) ? 1 : 0;
  const attributeOverlap = attributeOverlapScore(row.supplierRawPayload, supplierTitle, marketplaceTitle);

  const penalties: string[] = [];
  if (marketplaceScore < 0.5) penalties.push("WEAK_MARKETPLACE_SCORE");
  if (fuzzySimilarity < 0.58) penalties.push("WEAK_FUZZY_SIMILARITY");
  if (tokenOverlap < 0.45) penalties.push("LOW_TOKEN_OVERLAP");
  if (productTypeAlignment < 1) penalties.push("PRODUCT_TYPE_MISMATCH");
  if (attributeOverlap < 0.25) penalties.push("ATTRIBUTE_OVERLAP_WEAK");

  let confidence =
    lexicalSimilarity * 0.22 +
    fuzzySimilarity * 0.2 +
    tokenOverlap * 0.16 +
    marketplaceScore * 0.16 +
    priceAlignment * 0.12 +
    productTypeAlignment * 0.08 +
    attributeOverlap * 0.06;

  const brandPenalty = brandedMarketplacePenalty(supplierTitle, marketplaceTitle);
  if (brandPenalty > 0) penalties.push("BRANDED_MARKETPLACE_GENERIC_SUPPLIER");
  confidence -= brandPenalty;
  confidence -= penalties.filter((p) => p === "LOW_TOKEN_OVERLAP" || p === "WEAK_FUZZY_SIMILARITY").length * 0.04;

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    lexicalSimilarity: Number(lexicalSimilarity.toFixed(4)),
    fuzzySimilarity: Number(fuzzySimilarity.toFixed(4)),
    tokenOverlap: Number(tokenOverlap.toFixed(4)),
    marketplaceScore: Number(marketplaceScore.toFixed(4)),
    priceAlignment: Number(priceAlignment.toFixed(4)),
    productTypeAlignment,
    attributeOverlap: Number(attributeOverlap.toFixed(4)),
    penalties,
    confidence: Number(confidence.toFixed(4)),
  };
}

function confidenceStatus(confidence: number): MatchStatus {
  return getMatchRoutingStatus(confidence);
}

function detectMatchType(score: number): string {
  if (score >= PRODUCT_PIPELINE_MATCH_PREFERRED_MIN) return "strong_title_similarity";
  if (score >= PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN) return "manual_review_similarity";
  return "weak_similarity_rejected";
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
  confidence: number;
  matchStatus: MatchStatus;
  quality: MatchQuality;
};

function chooseBestCandidate(rows: CandidateRow[]): RankedCandidate | null {
  let best: RankedCandidate | null = null;

  for (const row of rows) {
    const supplierTitle = String(row.supplierTitle || "");
    const matchedTitle = String(row.matchedTitle || "");
    if (!supplierTitle || !matchedTitle || !row.marketplaceListingId || !row.marketplaceKey) continue;

    const quality = evaluateMatchQuality(row);
    const matchStatus = confidenceStatus(quality.confidence);
    if (matchStatus === "REJECTED") continue;

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
          ? normalizeSupplierQuality(String((row.supplierRawPayload as Record<string, unknown>).snapshotQuality ?? ""))
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
      matchConfidence: quality.confidence,
    });

    if (!pipeline.eligible && !pipeline.manualReview) continue;

    const candidate: RankedCandidate = {
      ...row,
      confidence: quality.confidence,
      matchStatus,
      quality,
    };

    if (!best || candidate.confidence > best.confidence) {
      best = candidate;
      continue;
    }

    if (candidate.confidence === best.confidence && candidate.quality.marketplaceScore > best.quality.marketplaceScore) {
      best = candidate;
    }
  }

  return best;
}

export async function runEbayMatches(input?: { limit?: number; productRawId?: string }) {
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
        .where(and(eq(marketplacePrices.marketplaceKey, "ebay"), eq(marketplacePrices.productRawId, input.productRawId)))
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
        .orderBy(asc(marketplacePrices.snapshotTs), desc(marketplacePrices.id))
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
  let rejected = 0;
  let manualReview = 0;
  let active = 0;
  let skippedNoQualifiedCandidate = 0;

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
    const status = confidenceStatus(best.confidence);

    const evidence = {
      supplierTitle: String(best.supplierTitle || ""),
      matchedTitle,
      marketplaceKey: best.marketplaceKey,
      marketplaceListingId: best.marketplaceListingId,
      quality: best.quality,
      confidenceThresholds: {
        active: PRODUCT_PIPELINE_MATCH_PREFERRED_MIN,
        manualReview: PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN,
      },
      selectionMode: "best_per_supplier_product",
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
          status,
          lastSeenTs: new Date(),
        })
        .where(eq(matches.id, existing[0].id));

      updated++;
    } else {
      await db.insert(matches).values({
        supplierKey,
        supplierProductId,
        marketplaceKey: "ebay",
        marketplaceListingId: String(best.marketplaceListingId),
        matchType: detectMatchType(best.confidence),
        confidence: String(best.confidence),
        evidence,
        status,
        firstSeenTs: new Date(),
        lastSeenTs: new Date(),
      });

      inserted++;
    }

    if (status === "ACTIVE") active++;
    else if (status === "MANUAL_REVIEW") manualReview++;
    else rejected++;
  }

  return {
    ok: true,
    scanned,
    inserted,
    updated,
    active,
    manualReview,
    rejected,
    skippedNoQualifiedCandidate,
    confidencePolicy: {
      activeMin: PRODUCT_PIPELINE_MATCH_PREFERRED_MIN,
      manualReviewMin: PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN,
    },
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
