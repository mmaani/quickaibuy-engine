import pg from "pg";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

const { Client } = pg;

type CandidateRow = {
  id: string;
};

function optionalCandidateId(): string | null {
  const raw = String(process.argv[2] ?? "").trim();
  return raw || null;
}

async function findCandidateId(client: pg.Client, preferredId: string | null): Promise<string> {
  if (preferredId) {
    const selected = await client.query<CandidateRow>(
      `
        SELECT id
        FROM profitable_candidates
        WHERE id = $1
          AND marketplace_key = 'ebay'
          AND decision_status = 'APPROVED'
          AND listing_eligible = TRUE
        LIMIT 1
      `,
      [preferredId]
    );

    if (!selected.rows.length) {
      throw new Error(`candidate not eligible for eBay READY flow: ${preferredId}`);
    }
    return selected.rows[0].id;
  }

  const auto = await client.query<CandidateRow>(`
    SELECT pc.id
    FROM profitable_candidates pc
    WHERE pc.marketplace_key = 'ebay'
      AND pc.decision_status = 'APPROVED'
      AND pc.listing_eligible = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM listings l2
        WHERE l2.candidate_id = pc.id
          AND l2.marketplace_key = 'ebay'
      )
    ORDER BY pc.calc_ts DESC
    LIMIT 1
  `);

  if (!auto.rows.length) {
    throw new Error("no APPROVED + listing_eligible eBay candidate found without active live-path listing");
  }

  return auto.rows[0].id;
}

async function findPreviewListingId(client: pg.Client, candidateId: string): Promise<string> {
  const preview = await client.query<{ id: string }>(
    `
      SELECT l.id
      FROM listings l
      WHERE l.candidate_id = $1
        AND l.marketplace_key = 'ebay'
        AND l.status = 'PREVIEW'
      ORDER BY l.updated_at DESC, l.created_at DESC
      LIMIT 1
    `,
    [candidateId]
  );

  if (!preview.rows.length) {
    throw new Error(`no PREVIEW listing found for candidate ${candidateId} after prepare`);
  }

  return preview.rows[0].id;
}

async function main() {
  const { prepareListingPreviewForCandidate } = await import("@/lib/listings/prepareListingPreviews");
  const { markListingReadyToPublish } = await import("@/lib/listings/markListingReadyToPublish");
  const preferredId = optionalCandidateId();
  const client = new Client({
    connectionString: getRequiredDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const candidateId = await findCandidateId(client, preferredId);

    const prepareResult = await prepareListingPreviewForCandidate(candidateId, {
      marketplace: "ebay",
      forceRefresh: false,
    });

    const listingId = await findPreviewListingId(client, candidateId);

    const promoteResult = await markListingReadyToPublish({
      listingId,
      actorId: "prepare_one_ready_to_publish",
      actorType: "SYSTEM",
    });

    if (!promoteResult.ok) {
      throw new Error(promoteResult.reason || "failed to promote listing to READY_TO_PUBLISH");
    }

    console.log(`SELECTED_CANDIDATE_ID=${candidateId}`);
    console.log(`SELECTED_LISTING_ID=${listingId}`);
    console.log(
      JSON.stringify(
        {
          candidateId,
          listingId,
          prepareResult,
          promoteResult,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
