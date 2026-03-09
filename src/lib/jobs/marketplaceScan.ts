import { runTrendMarketplaceScanner } from "@/lib/marketplaces/trendMarketplaceScanner";

export type MarketplaceScanJobData = {
  limit?: number;
  productRawId?: string;
  platform?: "amazon" | "ebay" | "all";
};

export async function handleMarketplaceScanJob(data: MarketplaceScanJobData) {
  return runTrendMarketplaceScanner({
    limit: Number(data?.limit ?? 100),
    productRawId: data?.productRawId ? String(data.productRawId).trim() : undefined,
    platform: (data?.platform ?? "ebay") as "amazon" | "ebay" | "all",
  });
}
