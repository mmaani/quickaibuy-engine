import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

function isLivePublishEnabled(): boolean {
  return String(process.env.ENABLE_EBAY_LIVE_PUBLISH ?? "false").trim().toLowerCase() === "true";
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const livePublishEnabled = isLivePublishEnabled();

  const readyRows = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status,
      idempotency_key,
      publish_attempt_count,
      updated_at
    FROM listings
    WHERE status = 'READY_TO_PUBLISH'
      AND marketplace_key = 'ebay'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `);

  console.log("READY_TO_PUBLISH candidates:");
  console.table(readyRows.rows);

  if (readyRows.rows.length === 0) {
    console.log("No READY_TO_PUBLISH rows found.");
    await client.end();
    return;
  }

  const row = readyRows.rows[0];

  if (!livePublishEnabled) {
    const result = await client.query(
      `
        UPDATE listings
        SET
          response = COALESCE(response, '{}'::jsonb) || $2::jsonb,
          updated_at = NOW(),
          last_publish_error = NULL,
          publish_attempt_count = COALESCE(publish_attempt_count, 0) + 1
        WHERE id = $1
          AND status = 'READY_TO_PUBLISH'
        RETURNING id, candidate_id, marketplace_key, status, updated_at, publish_attempt_count
      `,
      [
        row.id,
        JSON.stringify({
          dryRun: true,
          liveApiCalled: false,
          singleListingCheckedAt: new Date().toISOString(),
          script: "run_single_listing_publish.ts",
          featureFlagEnabled: false,
        }),
      ]
    );

    console.log("Dry-run result (feature flag OFF):");
    console.table(result.rows);
    await client.end();
    return;
  }

  console.log("ENABLE_EBAY_LIVE_PUBLISH=true detected. Refusing broad execution from this guard script.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
