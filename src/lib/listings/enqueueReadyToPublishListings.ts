import { getListingExecutionCandidates } from "@/lib/listings/getListingExecutionCandidates";
import { buildListingPublishIdempotencyKey } from "@/lib/listings/publishIdempotency";

export type EnqueueReadyToPublishResult = {
  ok: boolean;
  marketplaceKey: "ebay";
  queued: number;
  skipped: number;
  jobs: Array<{
    listingId: string;
    candidateId: string;
    jobIdempotencyKey: string;
  }>;
};

export async function enqueueReadyToPublishListings(input?: {
  limit?: number;
  marketplaceKey?: "ebay";
}) : Promise<EnqueueReadyToPublishResult> {
  const marketplaceKey = (input?.marketplaceKey ?? "ebay") as "ebay";
  const rows = await getListingExecutionCandidates({
    limit: input?.limit ?? 10,
    marketplace: marketplaceKey,
  });

  const jobs = rows.map((row) => ({
    listingId: row.id,
    candidateId: row.candidateId,
    jobIdempotencyKey: buildListingPublishIdempotencyKey({
      listingId: row.id,
      marketplaceKey,
    }),
  }));

  return {
    ok: true,
    marketplaceKey,
    queued: jobs.length,
    skipped: 0,
    jobs,
  };
}
