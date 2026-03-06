import type { SupplierProduct } from "./types";

export async function searchAliExpressByKeyword(
  keyword: string,
  limit = 20
): Promise<SupplierProduct[]> {
  const capped = Math.min(Math.max(limit, 1), 20);
  const snapshotTs = new Date().toISOString();

  return [
    {
      title: `${keyword} sample from AliExpress`,
      price: "9.99",
      currency: "USD",
      images: [],
      variants: [],
      sourceUrl: `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(keyword)}`,
      supplierProductId: `aliexpress-${keyword.toLowerCase().replace(/\s+/g, "-")}-1`,
      shippingEstimates: [],
      platform: "AliExpress",
      keyword,
      snapshotTs,
      raw: {
        mode: "stub",
        keyword,
        platform: "AliExpress",
      },
    },
  ].slice(0, capped);
}
