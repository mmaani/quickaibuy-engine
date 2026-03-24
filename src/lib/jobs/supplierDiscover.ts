import { getTrendCandidates } from "@/lib/db/trendCandidates";
import { insertProductsRaw } from "@/lib/db/productsRaw";
import {
  buildFocusedSupplierDiscoverKeywords,
  evaluateProductPipelinePolicy,
} from "@/lib/products/pipelinePolicy";
import { searchAliExpressByKeyword } from "@/lib/products/suppliers/aliexpress";
import { searchAlibabaByKeyword } from "@/lib/products/suppliers/alibaba";
import { searchCjByKeyword } from "@/lib/products/suppliers/cjdropshipping";
import { searchTemuByKeyword } from "@/lib/products/suppliers/temu";
import { supplierProductToRawInsert } from "@/lib/products/supplierSnapshots";

export type SupplierDiscoverResult = {
  processedCandidates: number;
  insertedCount: number;
  scannedProducts: number;
  scoredProducts: number;
  keywords: string[];
  sources: string[];
};

export async function runSupplierDiscover(limitPerKeyword = 20): Promise<SupplierDiscoverResult> {
  const candidateLimit = Math.max(
    1,
    Math.min(Number(process.env.SUPPLIER_DISCOVER_CANDIDATE_LIMIT ?? 20), 100)
  );
  const candidates = await getTrendCandidates(candidateLimit);
  const focusedKeywords = buildFocusedSupplierDiscoverKeywords(candidates.map((row) => row.candidate));

  let insertedCount = 0;
  let scannedProducts = 0;
  let scoredProducts = 0;
  const keywords: string[] = [];
  const sources = new Set<string>();

  for (const keyword of focusedKeywords) {
    keywords.push(keyword);

    const [cj, aliexpress, alibaba, temu] = await Promise.all([
      searchCjByKeyword(keyword, limitPerKeyword),
      searchAliExpressByKeyword(keyword, limitPerKeyword),
      searchAlibabaByKeyword(keyword, limitPerKeyword),
      searchTemuByKeyword(keyword, limitPerKeyword),
    ]);

    const allProducts = [...cj, ...aliexpress, ...alibaba, ...temu];
    scannedProducts += allProducts.length;

    if (!allProducts.length) continue;

    const eligibleProducts = allProducts.filter((item) => {
      const additionalImageCount = Math.max(0, item.images.length - 1);
      const quality = evaluateProductPipelinePolicy({
        title: item.title,
        supplierTitle: item.title,
        imageUrl: item.images[0] ?? null,
        additionalImageCount,
        supplierKey: item.platform,
        supplierQuality: item.snapshotQuality ?? null,
        telemetrySignals: item.telemetrySignals ?? [],
        availabilitySignal: item.availabilitySignal ?? null,
        availabilityConfidence: item.availabilityConfidence ?? null,
        shippingEstimates: item.shippingEstimates,
        supplierPrice: item.price ? Number(item.price) : null,
      });
      item.raw = {
        ...item.raw,
        pipelinePolicy: quality,
      };
      if (quality.eligible) scoredProducts++;
      return quality.eligible;
    });

    if (!eligibleProducts.length) continue;

    for (const item of eligibleProducts) {
      sources.add(item.platform);
    }

    insertedCount += await insertProductsRaw(eligibleProducts.map(supplierProductToRawInsert));
  }

  return {
    processedCandidates: keywords.length,
    insertedCount,
    scannedProducts,
    scoredProducts,
    keywords,
    sources: Array.from(sources),
  };
}
