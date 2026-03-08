import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { matchSupplierProductsToMarketplaceListings } =
    await import("@/lib/matching/productMatcher");

  const result = await matchSupplierProductsToMarketplaceListings({
    limit: 20,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
