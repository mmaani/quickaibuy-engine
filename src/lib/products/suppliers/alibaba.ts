import type { SupplierProduct } from "./types";

export async function searchAlibabaByKeyword(
  keyword: string,
  limit = 20
): Promise<SupplierProduct[]> {
  const capped = Math.min(Math.max(limit, 1), 20);
  const snapshotTs = new Date().toISOString();

  const rows: SupplierProduct[] = [
    {
      title: `${keyword} sample from Alibaba`,
      price: "12.50",
      currency: "USD",
      images: [],
      variants: [],
      sourceUrl: `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(keyword)}`,
      supplierProductId: `alibaba-${keyword.toLowerCase().replace(/\s+/g, "-")}-1`,
      shippingEstimates: [],
      platform: "Alibaba",
      keyword,
      snapshotTs,
      availabilitySignal: "UNKNOWN",
      availabilityConfidence: 0.35,
      raw: {
        mode: "stub",
        keyword,
        platform: "Alibaba",
        availabilitySignal: "UNKNOWN",
        availabilityConfidence: 0.35,
      },
    },
  ];

  return rows.slice(0, capped);
}
