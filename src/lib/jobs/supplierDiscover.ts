import { getTrendCandidates } from "@/lib/db/trendCandidates";
import { insertProductsRaw } from "@/lib/db/productsRaw";
import { searchAliExpressByKeyword } from "@/lib/products/suppliers/aliexpress";
import { searchAlibabaByKeyword } from "@/lib/products/suppliers/alibaba";
import { searchTemuByKeyword } from "@/lib/products/suppliers/temu";
import { supplierProductToRawInsert } from "@/lib/products/supplierSnapshots";

export type SupplierDiscoverResult = {
  processedCandidates: number;
  insertedCount: number;
  keywords: string[];
  sources: string[];
};

export async function runSupplierDiscover(limitPerKeyword = 20): Promise<SupplierDiscoverResult> {
  const candidates = await getTrendCandidates(50);

  let insertedCount = 0;
  const keywords: string[] = [];
  const sources = new Set<string>();

  for (const row of candidates) {
    const keyword = String(row.candidate ?? "").trim();
    if (!keyword) continue;

    keywords.push(keyword);

    const [aliexpress, alibaba, temu] = await Promise.all([
      searchAliExpressByKeyword(keyword, limitPerKeyword),
      searchAlibabaByKeyword(keyword, limitPerKeyword),
      searchTemuByKeyword(keyword, limitPerKeyword),
    ]);

    const allProducts = [...aliexpress, ...alibaba, ...temu];

    if (!allProducts.length) continue;

    for (const item of allProducts) {
      sources.add(item.platform);
    }

    insertedCount += await insertProductsRaw(allProducts.map(supplierProductToRawInsert));
  }

  return {
    processedCandidates: keywords.length,
    insertedCount,
    keywords,
    sources: Array.from(sources),
  };
}
