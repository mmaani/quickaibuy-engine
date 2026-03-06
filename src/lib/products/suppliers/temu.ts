import type { SupplierProduct } from "./types";

export async function searchTemuByKeyword(
  keyword: string,
  limit = 20
): Promise<SupplierProduct[]> {
  const capped = Math.min(Math.max(limit, 1), 20);
  const snapshotTs = new Date().toISOString();

  const rows: SupplierProduct[] = [
    {
      title: `${keyword} sample from Temu`,
      price: "7.45",
      currency: "USD",
      images: [],
      variants: [],
      sourceUrl: `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(keyword)}`,
      supplierProductId: `temu-${keyword.toLowerCase().replace(/\s+/g, "-")}-1`,
      shippingEstimates: [],
      platform: "Temu",
      keyword,
      snapshotTs,
      raw: {
        mode: "stub",
        keyword,
        platform: "Temu",
      },
    },
  ];

  return rows.slice(0, capped);
}
