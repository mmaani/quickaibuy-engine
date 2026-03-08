import { runEbayMatches } from "@/lib/matches/ebayMatchEngine";

export type MatchProductsJobData = {
  limit?: number;
  productRawId?: string;
};

export async function handleMatchProductsJob(data: MatchProductsJobData) {
  return runEbayMatches({
    limit: Number(data?.limit ?? 50),
    productRawId: data?.productRawId ? String(data.productRawId).trim() : undefined,
  });
}
