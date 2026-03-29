import { runEbayMatches } from "@/lib/matches/ebayMatchEngine";
import { recordMatchLearning } from "@/lib/learningHub/pipelineWriters";

export type MatchProductsJobData = {
  limit?: number;
  productRawId?: string;
};

export async function handleMatchProductsJob(data: MatchProductsJobData) {
  const result = await runEbayMatches({
    limit: Number(data?.limit ?? 50),
    productRawId: data?.productRawId ? String(data.productRawId).trim() : undefined,
  });
  await recordMatchLearning({
    scanned: Number(result.scanned ?? 0),
    inserted: Number(result.inserted ?? 0),
    updated: Number(result.updated ?? 0),
    active: Number(result.active ?? 0),
    manualReview: Number(result.manualReview ?? 0),
    rejected: Number(result.rejected ?? 0),
    skippedNoQualifiedCandidate: Number(result.skippedNoQualifiedCandidate ?? 0),
  });
  return result;
}
