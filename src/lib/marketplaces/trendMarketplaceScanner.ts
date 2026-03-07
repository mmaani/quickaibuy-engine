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

async function searchPlatform(
  platform: "amazon" | "ebay",
  query: string,
  limit: number
): Promise<MarketplaceCandidate[]> {
  if (platform === "ebay") return searchEbay(query, limit);
  return searchAmazon(query, limit);
}

export async function scanOneProductTrendMode(
  product: ProductRawLite,
  requestedPlatform: "amazon" | "ebay" | "all" = "all"
): Promise<MarketplaceCandidate[]> {
  const title = String(product.title || "").trim();
  if (!title) return [];

  const mainKeywords = extractMainKeywordsFromRawPayload(product.rawPayload);
  const queries = buildSearchQueries({ title, mainKeywords });

  const platforms =
    requestedPlatform === "all" ? (["ebay", "amazon"] as const) : ([requestedPlatform] as const);

  const bestByPlatform = new Map<string, MarketplaceCandidate>();
  const minScore = Number(process.env.MARKETPLACE_MIN_MATCH_SCORE || "0.45");
  const perQueryLimit = Number(process.env.MARKETPLACE_QUERY_LIMIT || "10");
  const delayMs = Number(process.env.MARKETPLACE_SCAN_DELAY_MS || "300");

  for (const query of queries) {
    for (const platform of platforms) {
      const candidates = await searchPlatform(platform, query, perQueryLimit);

      for (const raw of candidates) {
        const scored = scoreCandidate({ title, mainKeywords }, raw);
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
    ? (() => {
        return Promise.resolve(input.productRawId);
      })().then(async (id) => {
        const one = await getProductRawById(id);
        return one ? [one] : [];
      })
    : getProductsRawForMarketplaceScan(limit);

  const resolvedProducts = await products;

  let inserted = 0;
  let scanned = 0;

  for (const product of resolvedProducts) {
    scanned++;

    const matches = await scanOneProductTrendMode(product, platform);

    for (const match of matches) {
      if (!match.marketplaceListingId || !match.matchedTitle || match.price == null || !match.currency) {
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
    }
  }

  return {
    ok: true,
    scanned,
    inserted,
    platform,
    productRawId: input?.productRawId ?? null,
  };
}
