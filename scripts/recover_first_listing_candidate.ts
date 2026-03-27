import dotenv from "dotenv";
import pg from "pg";
import { runProfitEngine } from "@/lib/profit/profitEngine";
import {
  prepareListingPreviewForCandidate,
} from "@/lib/listings/prepareListingPreviews";
import { markListingReadyToPublish } from "@/lib/listings/markListingReadyToPublish";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel" });
dotenv.config();

const { Client } = pg;

type CountRow = {
  approved_candidates: number;
  listing_eligible: number;
  preview_prepared: number;
  ready_to_publish: number;
};

type CandidateRow = {
  id: string;
  supplier_key: string;
  supplier_product_id: string;
  decision_status: string;
  listing_eligible: boolean;
  listing_block_reason: string | null;
};

async function fetchCounts(client: pg.Client): Promise<CountRow> {
  const result = await client.query<CountRow>(`
    SELECT
      count(*) FILTER (WHERE decision_status = 'APPROVED')::int AS approved_candidates,
      count(*) FILTER (WHERE decision_status = 'APPROVED' AND listing_eligible = true)::int AS listing_eligible,
      count(*) FILTER (WHERE decision_status = 'APPROVED' AND l.id IS NOT NULL)::int AS preview_prepared,
      count(*) FILTER (WHERE decision_status = 'APPROVED' AND l.status = 'READY_TO_PUBLISH')::int AS ready_to_publish
    FROM profitable_candidates pc
    LEFT JOIN LATERAL (
      SELECT id, status
      FROM listings l
      WHERE l.candidate_id = pc.id
        AND l.marketplace_key = pc.marketplace_key
      ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
      LIMIT 1
    ) l ON true
    WHERE lower(pc.marketplace_key) = 'ebay'
  `);
  return result.rows[0];
}

async function fetchApprovedEligibleCandidates(client: pg.Client): Promise<CandidateRow[]> {
  const result = await client.query<CandidateRow>(`
    SELECT
      pc.id,
      pc.supplier_key,
      pc.supplier_product_id,
      pc.decision_status,
      pc.listing_eligible,
      pc.listing_block_reason
    FROM profitable_candidates pc
    WHERE lower(pc.marketplace_key) = 'ebay'
      AND pc.decision_status = 'APPROVED'
      AND pc.listing_eligible = true
    ORDER BY pc.calc_ts DESC
    LIMIT 20
  `);
  return result.rows;
}

async function fetchListingStatus(client: pg.Client, candidateId: string) {
  const result = await client.query<{
    id: string;
    status: string;
    title: string;
  }>(
    `
      SELECT l.id, l.status, l.title
      FROM listings l
      WHERE l.candidate_id = $1
        AND l.marketplace_key = 'ebay'
      ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
      LIMIT 1
    `,
    [candidateId]
  );
  return result.rows[0] ?? null;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const before = await fetchCounts(client);
    const profitResult = await runProfitEngine({ limit: 250, marketplaceKey: "ebay" });
    const candidates = await fetchApprovedEligibleCandidates(client);

    const recovered: Array<Record<string, unknown>> = [];
    const blocked: Array<Record<string, unknown>> = [];

    for (const candidate of candidates) {
      try {
        const prepareResult = await prepareListingPreviewForCandidate(candidate.id, {
          marketplace: "ebay",
          forceRefresh: true,
        });
        const listing = await fetchListingStatus(client, candidate.id);
        let promoteResult: Record<string, unknown> | null = null;
        if (listing && listing.status === "PREVIEW") {
          const promoted = await markListingReadyToPublish({
            listingId: listing.id,
            actorId: "recover_first_listing_candidate",
            actorType: "SYSTEM",
          });
          promoteResult = promoted;
        }

        const finalListing = await fetchListingStatus(client, candidate.id);
        recovered.push({
          candidateId: candidate.id,
          supplierKey: candidate.supplier_key,
          supplierProductId: candidate.supplier_product_id,
          prepareResult,
          promoteResult,
          finalListing,
        });

        if (finalListing && ["PREVIEW", "READY_TO_PUBLISH"].includes(finalListing.status)) {
          break;
        }
      } catch (error) {
        blocked.push({
          candidateId: candidate.id,
          supplierKey: candidate.supplier_key,
          supplierProductId: candidate.supplier_product_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const after = await fetchCounts(client);
    console.log(
      JSON.stringify(
        {
          ok: true,
          before,
          profitResult,
          approvedEligibleCandidates: candidates,
          recovered,
          blocked,
          after,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("recover_first_listing_candidate failed", error);
  process.exit(1);
});
