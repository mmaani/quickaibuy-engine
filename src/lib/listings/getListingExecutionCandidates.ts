import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type ListingExecutionCandidate = {
  id: string;
  candidateId: string;
  marketplaceKey: string;
  title: string;
  price: string;
  status: string;
  idempotencyKey: string | null;
};

export async function getListingExecutionCandidates(input?: {
  limit?: number;
  marketplace?: "ebay" | "amazon";
}) {
  const limit = Number(input?.limit ?? 10);
  const marketplace = (input?.marketplace ?? "ebay").toLowerCase();

  const result = await db.execute(sql`
    SELECT
      l.id,
      l.candidate_id AS "candidateId",
      l.marketplace_key AS "marketplaceKey",
      l.title,
      l.price::text AS price,
      l.status,
      l.idempotency_key AS "idempotencyKey"
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.marketplace_key = ${marketplace}
      AND l.status = 'PREVIEW'
      AND pc.decision_status = 'APPROVED'
    ORDER BY l.updated_at ASC, l.created_at ASC
    LIMIT ${limit}
  `);

  return result.rows as ListingExecutionCandidate[];
}
