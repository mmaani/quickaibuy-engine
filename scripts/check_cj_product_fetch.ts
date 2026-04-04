import {
  formatCjErrorForOperator,
  listCjProducts,
  queryCjProductById,
  searchCjProducts,
} from "@/lib/suppliers/cj";

async function main() {
  const keyword = String(process.argv[2] ?? "desk organizer").trim();
  const countryCode = String(process.env.CJ_DISCOVER_COUNTRY_CODE ?? "US").trim() || "US";
  const startWarehouseInventory = Math.max(1, Number(process.env.CJ_DISCOVER_MIN_INVENTORY ?? 10));

  const search = await searchCjProducts({
    keyword,
    size: 5,
    countryCode,
    startWarehouseInventory,
  });
  const firstProduct = search.products[0] ?? null;
  const detail = firstProduct?.id ? await queryCjProductById(String(firstProduct.id)) : null;
  const listed = firstProduct?.id ? await listCjProducts({ pid: String(firstProduct.id), pageSize: 1 }) : null;
  const listedData = listed?.data;
  const listedCount =
    Array.isArray(listedData)
      ? listedData.length
      : listedData && typeof listedData === "object" && Array.isArray((listedData as { list?: unknown[] }).list)
        ? ((listedData as { list?: unknown[] }).list ?? []).length
        : null;

  const ok = Boolean(search.wrapped && firstProduct && detail);
  console.log(
    JSON.stringify(
      {
        ok,
        keyword,
        resultCount: search.products.length,
        firstProductId: firstProduct?.id ?? null,
        firstProductName: firstProduct?.nameEn ?? null,
        detailId: detail?.ID ?? null,
        detailName: detail?.NAMEEN ?? detail?.NAME ?? null,
        listedCount,
      },
      null,
      2
    )
  );
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: formatCjErrorForOperator(error) }, null, 2));
  process.exitCode = 1;
});
