import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const sourceUrl = String(process.argv[2] ?? "").trim();

  if (!sourceUrl) {
    console.error("Usage: pnpm exec tsx scripts/ingest_cj_direct_product.ts <cj_product_url>");
    process.exit(1);
  }

  const { fetchCjDirectProduct } = await import("@/lib/products/suppliers/cjdropshipping");
  const { supplierProductToRawInsert } = await import("@/lib/products/supplierSnapshots");
  const { insertProductRawReturningId } = await import("@/lib/db/productsRaw");

  const result = await fetchCjDirectProduct(sourceUrl);
  const insertRow = supplierProductToRawInsert(result.product);
  insertRow.supplierKey = "cjdropshipping";
  insertRow.priceMin = result.priceMin;
  insertRow.priceMax = result.priceMax;

  const productRawId = await insertProductRawReturningId(insertRow);

  console.log(
    JSON.stringify(
      {
        ok: true,
        productRawId,
        supplierKey: insertRow.supplierKey,
        supplierProductId: insertRow.supplierProductId,
        title: result.product.title,
        sourceUrl: result.product.sourceUrl,
        priceMin: result.priceMin,
        priceMax: result.priceMax,
        availabilityStatus: result.product.availabilitySignal,
        availabilityConfidence: result.product.availabilityConfidence,
        stockCount: result.stockCount,
        inventoryEvidenceText: result.inventoryEvidenceText,
        detailCacheUrl: result.detailCacheUrl,
        inventoryCacheUrl: result.inventoryCacheUrl,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
