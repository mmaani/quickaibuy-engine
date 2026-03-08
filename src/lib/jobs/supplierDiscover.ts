import { getTrendCandidates } from "@/lib/db/trendCandidates";
import { insertProductsRaw } from "@/lib/db/productsRaw";
import type { InsertRawProductInput } from "@/lib/db/productsRaw";
import { searchAliExpressByKeyword } from "@/lib/products/suppliers/aliexpress";
import { searchAlibabaByKeyword } from "@/lib/products/suppliers/alibaba";
import { searchTemuByKeyword } from "@/lib/products/suppliers/temu";
import type { SupplierProduct } from "@/lib/products/suppliers/types";

export type SupplierDiscoverResult = {
  processedCandidates: number;
  insertedCount: number;
  keywords: string[];
  sources: string[];
};

function toRawInsert(product: SupplierProduct): InsertRawProductInput {
  const snapshotTs = new Date(product.snapshotTs);

  return {
    supplierKey: String(product.platform ?? "").trim().toLowerCase(),
    supplierProductId: product.supplierProductId ?? product.sourceUrl,
    sourceUrl: product.sourceUrl,
    title: product.title,
    images: product.images,
    variants: product.variants,
    currency: product.currency,
    priceMin: product.price,
    priceMax: product.price,
    shippingEstimates: product.shippingEstimates,
    rawPayload: {
      jobType: "supplier:discover",
      keyword: product.keyword,
      title: product.title,
      price: product.price,
      currency: product.currency,
      images: product.images,
      variants: product.variants,
      shippingEstimates: product.shippingEstimates,
      sourceUrl: product.sourceUrl,
      supplierProductId: product.supplierProductId,
      snapshotTs: product.snapshotTs,
      platform: product.platform,
      ...product.raw,
    },
    snapshotTs,
  };
}

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

    insertedCount += await insertProductsRaw(allProducts.map(toRawInsert));
  }

  return {
    processedCandidates: keywords.length,
    insertedCount,
    keywords,
    sources: Array.from(sources),
  };
}
