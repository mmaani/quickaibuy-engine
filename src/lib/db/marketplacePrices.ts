import { db } from "@/lib/db";
import { marketplacePrices } from "@/lib/db/schema";
import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { desc, eq, sql } from "drizzle-orm";

export type InsertMarketplacePriceSnapshotInput = {
  marketplaceKey: "ebay" | "amazon";
  marketplaceListingId: string;
  productRawId?: string | null;
  supplierKey?: string | null;
  supplierProductId?: string | null;
  trendMode?: boolean;
  searchQuery?: string | null;
  matchedTitle: string;
  productPageUrl?: string | null;
  imageUrl?: string | null;
  currency: string;
  price: string | number;
  shippingPrice?: string | number | null;
  isPrime?: boolean | null;
  availabilityStatus?: string | null;
  sellerId?: string | null;
  sellerName?: string | null;
  titleSimilarityScore?: string | number | null;
  keywordScore?: string | number | null;
  finalMatchScore?: string | number | null;
  rawPayload: unknown;
  snapshotTs?: Date;
};

export async function insertMarketplacePriceSnapshot(
  input: InsertMarketplacePriceSnapshotInput
) {
  const values = {
    marketplaceKey: normalizeMarketplaceKey(input.marketplaceKey),
    marketplaceListingId: input.marketplaceListingId,
    productRawId: input.productRawId ?? null,
    supplierKey: input.supplierKey ?? null,
    supplierProductId: input.supplierProductId ?? null,
    trendMode: input.trendMode ?? true,
    searchQuery: input.searchQuery ?? null,
    matchedTitle: input.matchedTitle,
    productPageUrl: input.productPageUrl ?? null,
    imageUrl: input.imageUrl ?? null,
    currency: input.currency,
    price: String(input.price),
    shippingPrice: input.shippingPrice != null ? String(input.shippingPrice) : null,
    isPrime: input.isPrime ?? null,
    availabilityStatus: input.availabilityStatus ?? null,
    sellerId: input.sellerId ?? null,
    sellerName: input.sellerName ?? null,
    titleSimilarityScore:
      input.titleSimilarityScore != null ? String(input.titleSimilarityScore) : null,
    keywordScore:
      input.keywordScore != null ? String(input.keywordScore) : null,
    finalMatchScore:
      input.finalMatchScore != null ? String(input.finalMatchScore) : null,
    rawPayload: input.rawPayload,
    snapshotTs: input.snapshotTs ?? new Date(),
  };

  await db
    .insert(marketplacePrices)
    .values(values)
    .onConflictDoUpdate({
      target: [
        marketplacePrices.marketplaceKey,
        marketplacePrices.marketplaceListingId,
        marketplacePrices.productRawId,
      ],
      set: {
        supplierKey: values.supplierKey,
        supplierProductId: values.supplierProductId,
        trendMode: values.trendMode,
        searchQuery: values.searchQuery,
        matchedTitle: values.matchedTitle,
        productPageUrl: values.productPageUrl,
        imageUrl: sql`coalesce(excluded.image_url, ${marketplacePrices.imageUrl})`,
        currency: values.currency,
        price: values.price,
        shippingPrice: values.shippingPrice,
        isPrime: values.isPrime,
        availabilityStatus: values.availabilityStatus,
        sellerId: values.sellerId,
        sellerName: values.sellerName,
        titleSimilarityScore: values.titleSimilarityScore,
        keywordScore: values.keywordScore,
        finalMatchScore: values.finalMatchScore,
        rawPayload: values.rawPayload,
        snapshotTs: values.snapshotTs,
      },
    });
}

export async function getRecentMarketplacePrices(limit = 20) {
  return db
    .select()
    .from(marketplacePrices)
    .orderBy(desc(marketplacePrices.snapshotTs))
    .limit(limit);
}

export async function getMarketplacePricesByProductRawId(productRawId: string) {
  return db
    .select()
    .from(marketplacePrices)
    .where(eq(marketplacePrices.productRawId, productRawId))
    .orderBy(desc(marketplacePrices.snapshotTs));
}
