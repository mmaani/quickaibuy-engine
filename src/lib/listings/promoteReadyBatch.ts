import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { markListingReadyToPublish } from "@/lib/listings/markListingReadyToPublish";

export type PromoteReadyBatchResult = {
  ok: boolean;
  scanned: number;
  promoted: number;
  blocked: number;
  results: Array<{
    listingId: string;
    candidateId: string;
    ok: boolean;
    reason: string | null;
  }>;
};

export async function promoteApprovedPreviewsToReady(input?: {
  limit?: number;
  actorId?: string;
  actorType?: "ADMIN" | "WORKER" | "SYSTEM";
}): Promise<PromoteReadyBatchResult> {
  const limit = Math.max(1, Math.min(Number(input?.limit ?? 20) || 20, 200));
  const rows = await db.execute<{
    listingId: string;
    candidateId: string;
  }>(sql`
    SELECT
      l.id::text AS "listingId",
      l.candidate_id::text AS "candidateId"
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.status = 'PREVIEW'
      AND lower(l.marketplace_key) = 'ebay'
      AND lower(pc.marketplace_key) = 'ebay'
      AND pc.decision_status = 'APPROVED'
      AND pc.listing_eligible = TRUE
    ORDER BY l.updated_at ASC NULLS LAST, l.created_at ASC NULLS LAST, l.id ASC
    LIMIT ${limit}
  `);

  const results: PromoteReadyBatchResult["results"] = [];
  for (const row of rows.rows ?? []) {
    const result = await markListingReadyToPublish({
      listingId: row.listingId,
      actorId: input?.actorId ?? "promoteApprovedPreviewsToReady",
      actorType: input?.actorType ?? "SYSTEM",
    });
    results.push({
      listingId: row.listingId,
      candidateId: row.candidateId,
      ok: result.ok,
      reason: result.reason ?? null,
    });
  }

  return {
    ok: true,
    scanned: rows.rows?.length ?? 0,
    promoted: results.filter((row) => row.ok).length,
    blocked: results.filter((row) => !row.ok).length,
    results,
  };
}
