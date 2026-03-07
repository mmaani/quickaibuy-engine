import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  console.log("env check:", {
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasEbayClientId: Boolean(process.env.EBAY_CLIENT_ID),
    hasEbayClientSecret: Boolean(process.env.EBAY_CLIENT_SECRET),
    ebayMarketplaceId: process.env.EBAY_MARKETPLACE_ID || null,
  });

  const { getProductsRawForMarketplaceScan } = await import("@/lib/db/productsRaw");
  const { scanOneProductTrendMode } = await import("@/lib/marketplaces/trendMarketplaceScanner");

  const rows = await getProductsRawForMarketplaceScan(3);

  console.log("products_raw rows:", rows.length);

  for (const row of rows) {
    console.log("\n==================================================");
    console.log("product_raw_id:", row.id);
    console.log("supplier_key:", row.supplierKey);
    console.log("supplier_product_id:", row.supplierProductId);
    console.log("title:", row.title);

    const matches = await scanOneProductTrendMode(row, "ebay");

    console.log("match count:", matches.length);

    for (const match of matches) {
      console.log(
        JSON.stringify(
          {
            marketplaceKey: match.marketplaceKey,
            marketplaceListingId: match.marketplaceListingId,
            matchedTitle: match.matchedTitle,
            price: match.price,
            shippingPrice: match.shippingPrice,
            currency: match.currency,
            sellerName: match.sellerName,
            availabilityStatus: match.availabilityStatus,
            finalMatchScore: match.finalMatchScore,
            searchQuery: match.searchQuery,
          },
          null,
          2
        )
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
