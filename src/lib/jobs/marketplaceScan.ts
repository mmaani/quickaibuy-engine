import { runTrendMarketplaceScanner } from "@/lib/marketplaces/trendMarketplaceScanner";
import { recordMarketplaceScanLearning } from "@/lib/learningHub/pipelineWriters";

export type MarketplaceScanJobData = {
  limit?: number;
  productRawId?: string;
  platform?: "amazon" | "ebay" | "all";
};

export async function handleMarketplaceScanJob(data: MarketplaceScanJobData) {
  const productRawId = data?.productRawId ? String(data.productRawId).trim() : undefined;
  const platform = (data?.platform ?? "ebay") as "amazon" | "ebay" | "all";
  try {
    const result = await runTrendMarketplaceScanner({
      limit: Number(data?.limit ?? 100),
      productRawId,
      platform,
    });
    await recordMarketplaceScanLearning({
      platform,
      productRawId,
      scanned: Number(result.scanned ?? 0),
      upserted: Number(result.upserted ?? 0),
      queryErrors: Number(result.queryErrors ?? 0),
      acceptedCount: Number(result.acceptedCandidates ?? 0),
      rejectedLowScoreCount: Number(result.rejectedLowScore ?? 0),
    });
    return result;
  } catch (error) {
    await recordMarketplaceScanLearning({
      platform,
      productRawId,
      scanned: 0,
      upserted: 0,
      queryErrors: 1,
    });
    throw error;
  }
}
