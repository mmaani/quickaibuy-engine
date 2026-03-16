import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const supplierKey = String(process.argv[2] ?? "").trim().toLowerCase();
  const supplierProductId = String(process.argv[3] ?? "").trim();

  if (!supplierKey || !supplierProductId) {
    console.error(
      "Usage: pnpm exec tsx scripts/refresh_single_supplier_product.ts <supplier_key> <supplier_product_id>"
    );
    process.exit(1);
  }

  const { refreshSingleSupplierProduct } = await import("@/lib/products/refreshSingleSupplierProduct");
  const result = await refreshSingleSupplierProduct({
    supplierKey,
    supplierProductId,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
