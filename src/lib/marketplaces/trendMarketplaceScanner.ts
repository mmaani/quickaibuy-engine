import { getProductRawById, getProductsRawForMarketplaceScan } from "@/lib/db/productsRaw";
import { insertMarketplacePriceSnapshot } from "@/lib/db/marketplacePrices";
import { searchEbay, type MarketplaceCandidate } from "./ebay";
import { searchAmazon } from "./amazon";
import {
  buildSearchQueries,
  extractMainKeywordsFromRawPayload,
  scoreCandidate,
} from "./match";

type ProductRawLite = {
  id: string;
  supplierKey: string;
  supplierProductId: string;
  title: string | null;
  currency: string | null;
  rawPayload: unknown;
  sourceUrl: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSupplierPrice(product: ProductRawLite): number | null {
  const raw = product.rawPayload;
  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;
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

function passesPriceSanity(product: ProductRawLite, match: MarketplaceCandidate): boolean {
  const supplierPrice = extractSupplierPrice(product);
  const marketplacePrice = match.price;

  if (!supplierPrice || !marketplacePrice) {
    return true;
  }

  const minRatio = Number(process.env.MARKETPLACE_MIN_PRICE_RATIO || "1.2");
  const maxRatio = Number(process.env.MARKETPLACE_MAX_PRICE_RATIO || "10");
  const ratio = marketplacePrice / supplierPrice;

  if (ratio < minRatio || ratio > maxRatio) {
    console.log("[marketplace-scan] skipped-price-outlier", {
      productRawId: product.id,
      supplierPrice,
      marketplacePrice,
      ratio: Number(ratio.toFixed(4)),
      minRatio,
      maxRatio,
      listingId: match.marketplaceListingId,
      matchedTitle: match.matchedTitle,
    });
    return false;
  }

  return true;
}

async function searchPlatform(
  platform: "amazon" | "ebay",
  query: string,
  limit: number
): Promise<MarketplaceCandidate[]> {
  if (platform === "ebay") return searchEbay(query, limit);
  return searchAmazon();
}

export async function scanOneProductTrendMode(
  product: ProductRawLite,
  requestedPlatform: "amazon" | "ebay" | "all" = "all"
): Promise<MarketplaceCandidate[]> {
  const title = String(product.title || "").trim();
  if (!title) return [];

  const mainKeywords = extractMainKeywordsFromRawPayload(product.rawPayload);
  const queries = buildSearchQueries({ title, mainKeywords });

  console.log("[marketplace-scan] product", {
    productRawId: product.id,
    title,
    queries,
    requestedPlatform,
  });

  const platforms =
    requestedPlatform === "all" ? (["ebay", "amazon"] as const) : ([requestedPlatform] as const);

  const bestByPlatform = new Map<string, MarketplaceCandidate>();
  const bestSeenByPlatform = new Map<string, MarketplaceCandidate>();

  const minScore = Number(process.env.MARKETPLACE_MIN_MATCH_SCORE || "0.45");
  const perQueryLimit = Number(process.env.MARKETPLACE_QUERY_LIMIT || "10");
  const delayMs = Number(process.env.MARKETPLACE_SCAN_DELAY_MS || "300");
  const allowFallback =
    String(process.env.MARKETPLACE_ALLOW_TOP_RESULT_FALLBACK || "true") === "true";

  for (const query of queries) {
    for (const platform of platforms) {
      const candidates = await searchPlatform(platform, query, perQueryLimit);

      console.log("[marketplace-scan] candidates", {
        productRawId: product.id,
        platform,
        query,
        candidateCount: candidates.length,
      });

      for (const raw of candidates) {
        const scored = scoreCandidate({ title, mainKeywords }, raw);

        console.log("[marketplace-scan] scored-candidate", {
          productRawId: product.id,
          platform,
          query,
          listingId: scored.marketplaceListingId,
          matchedTitle: scored.matchedTitle,
          finalMatchScore: scored.finalMatchScore,
          price: scored.price,
          currency: scored.currency,
        });

        const prevSeen = bestSeenByPlatform.get(platform);
        if (!prevSeen || (scored.finalMatchScore || 0) > (prevSeen.finalMatchScore || 0)) {
          bestSeenByPlatform.set(platform, scored);
        }

        if ((scored.finalMatchScore || 0) < minScore) continue;

        const prev = bestByPlatform.get(platform);
        if (!prev || (scored.finalMatchScore || 0) > (prev.finalMatchScore || 0)) {
          bestByPlatform.set(platform, scored);
        }
      }

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  if (allowFallback) {
    for (const platform of platforms) {
      if (!bestByPlatform.has(platform) && bestSeenByPlatform.has(platform)) {
        const fallback = bestSeenByPlatform.get(platform)!;
        console.log("[marketplace-scan] fallback-selected", {
          productRawId: product.id,
          platform,
          listingId: fallback.marketplaceListingId,
          score: fallback.finalMatchScore,
        });
        bestByPlatform.set(platform, fallback);
      }
    }
  }

  return Array.from(bestByPlatform.values());
}

export async function runTrendMarketplaceScanner(input?: {
  limit?: number;
  productRawId?: string;
  platform?: "amazon" | "ebay" | "all";
}) {
  const limit = Number(input?.limit ?? 100);
  const platform = input?.platform ?? "all";

  const products = input?.productRawId
    ? (() => Promise.resolve(input.productRawId))().then(async (id) => {
        const one = await getProductRawById(id);
        return one ? [one] : [];
      })
    : getProductsRawForMarketplaceScan(limit);

  const resolvedProducts = await products;

  let inserted = 0;
  let scanned = 0;

  console.log("[marketplace-scan] batch-start", {
    requestedLimit: limit,
    actualProducts: resolvedProducts.length,
    platform,
    productRawId: input?.productRawId ?? null,
  });

  for (const product of resolvedProducts) {
    scanned++;

    const matches = await scanOneProductTrendMode(product, platform);

    console.log("[marketplace-scan] product-matches", {
      productRawId: product.id,
      matchCount: matches.length,
    });

    for (const match of matches) {
      if (!match.marketplaceListingId || !match.matchedTitle || match.price == null || !match.currency) {
        console.log("[marketplace-scan] skipped-insert", {
          reason: "missing-required-fields",
          productRawId: product.id,
          listingId: match.marketplaceListingId,
          matchedTitle: match.matchedTitle,
          price: match.price,
          currency: match.currency,
        });
        continue;
      }

      if (!passesPriceSanity(product, match)) {
        continue;
      }

      await insertMarketplacePriceSnapshot({
        marketplaceKey: match.marketplaceKey,
        marketplaceListingId: match.marketplaceListingId,
        productRawId: product.id,
        supplierKey: product.supplierKey,
        supplierProductId: product.supplierProductId,
        trendMode: true,
        searchQuery: match.searchQuery ?? null,
        matchedTitle: match.matchedTitle,
        productPageUrl: match.productPageUrl ?? null,
        imageUrl: match.imageUrl ?? null,
        currency: match.currency,
        price: match.price,
        shippingPrice: match.shippingPrice,
        isPrime: match.isPrime ?? null,
        availabilityStatus: match.availabilityStatus ?? null,
        sellerId: match.sellerId ?? null,
        sellerName: match.sellerName ?? null,
        titleSimilarityScore: match.titleSimilarityScore ?? null,
        keywordScore: match.keywordScore ?? null,
        finalMatchScore: match.finalMatchScore ?? null,
        rawPayload: match.rawPayload,
      });

      inserted++;

      console.log("[marketplace-scan] inserted", {
        productRawId: product.id,
        platform: match.marketplaceKey,
        listingId: match.marketplaceListingId,
        score: match.finalMatchScore,
        productPageUrl: match.productPageUrl ?? null,
      });
    }
  }

  const result = {
    ok: true,
    scanned,
    inserted,
    platform,
    productRawId: input?.productRawId ?? null,
  };

  console.log("[marketplace-scan] batch-complete", result);

  return result;
}
