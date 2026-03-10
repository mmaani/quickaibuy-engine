import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { EbayListingPreviewPayload } from "./types";

export type ListingExecutionCandidate = {
  id: string;
  candidateId: string;
  marketplaceKey: "ebay";
  title: string;
  price: string;
  status: string;
  idempotencyKey: string | null;
  payload: EbayListingPreviewPayload | Record<string, unknown>;
};

type GetListingExecutionCandidatesInput = {
  limit?: number;
  marketplace?: "ebay";
  listingId?: string;
};

export async function getListingExecutionCandidates(
  input?: GetListingExecutionCandidatesInput
): Promise<ListingExecutionCandidate[]> {
  const limit = Number(input?.limit ?? 10);
  const marketplace = (input?.marketplace ?? "ebay") as "ebay";
  const listingId = String(input?.listingId ?? "").trim();

  const result = await db.execute(sql`
    SELECT
      l.id,
      l.candidate_id AS "candidateId",
      l.marketplace_key AS "marketplaceKey",
      l.title,
      l.price::text AS price,
      l.status,
      l.idempotency_key AS "idempotencyKey",
      l.payload
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.marketplace_key = ${marketplace}
      AND l.status = 'READY_TO_PUBLISH'
      AND pc.marketplace_key = ${marketplace}
      AND pc.decision_status = 'APPROVED'
      AND pc.listing_eligible = TRUE
      AND (${listingId} = '' OR l.id = ${listingId})
    ORDER BY l.updated_at ASC, l.created_at ASC
    LIMIT ${limit}
  `);

  return result.rows as ListingExecutionCandidate[];
}
