import dotenv from "dotenv";
import pg from "pg";
import { execSync } from "node:child_process";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

function requireSelectedId(): string {
  const id = String(process.argv[2] ?? "").trim();
  if (!id) {
    console.error("Usage: ENABLE_EBAY_LIVE_PUBLISH=true node scripts/run_first_guarded_live_publish.ts <listing_id>");
    process.exit(1);
  }
  return id;
}

function requireLiveFlag() {
  const enabled = String(process.env.ENABLE_EBAY_LIVE_PUBLISH ?? "false").trim().toLowerCase() === "true";
  if (!enabled) {
    console.error("ENABLE_EBAY_LIVE_PUBLISH must be true for this guarded live test.");
    process.exit(1);
  }
}

async function main() {
  const selectedId = requireSelectedId();
  requireLiveFlag();

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const selected = await client.query(
    `
      SELECT
        id,
        candidate_id,
        marketplace_key,
        status,
        idempotency_key,
        publish_attempt_count,
        updated_at
      FROM listings
      WHERE id = $1
      LIMIT 1
    `,
    [selectedId]
  );

  console.log("selected row:");
  console.table(selected.rows);

  if (selected.rows.length === 0) {
    console.error("Selected listing row not found.");
    await client.end();
    process.exit(1);
  }

  const row = selected.rows[0];

  if (row.marketplace_key !== "ebay") {
    console.error("Selected row is not an eBay listing.");
    await client.end();
    process.exit(1);
  }

  if (row.status !== "READY_TO_PUBLISH") {
    console.error(`Selected row must be READY_TO_PUBLISH. Current status: ${row.status}`);
    await client.end();
    process.exit(1);
  }

  const otherReadyRows = await client.query(
    `
      SELECT
        id,
        candidate_id,
        marketplace_key,
        status
      FROM listings
      WHERE marketplace_key = 'ebay'
        AND status = 'READY_TO_PUBLISH'
        AND id <> $1
      ORDER BY updated_at DESC, created_at DESC
    `,
    [selectedId]
  );

  console.log("other READY_TO_PUBLISH rows to demote temporarily:");
  console.table(otherReadyRows.rows);

  if (otherReadyRows.rows.length > 0) {
    const ids = otherReadyRows.rows.map((r) => r.id);

    const demoted = await client.query(
      `
        UPDATE listings
        SET
          status = 'PREVIEW',
          updated_at = NOW(),
          response = COALESCE(response, '{}'::jsonb) || $2::jsonb
        WHERE id = ANY($1::uuid[])
        RETURNING id, candidate_id, marketplace_key, status, updated_at
      `,
      [
        ids,
        JSON.stringify({
          temporarilyDemotedForGuardedLivePublish: true,
          demotedAt: new Date().toISOString(),
          selectedListingId: selectedId,
          script: "run_first_guarded_live_publish.ts",
        }),
      ]
    );

    console.log("temporarily demoted rows:");
    console.table(demoted.rows);
  }

  const remainingReady = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status
    FROM listings
    WHERE marketplace_key = 'ebay'
      AND status = 'READY_TO_PUBLISH'
    ORDER BY updated_at DESC, created_at DESC
  `);

  console.log("READY_TO_PUBLISH rows immediately before live publish:");
  console.table(remainingReady.rows);

  if (remainingReady.rows.length !== 1 || remainingReady.rows[0].id !== selectedId) {
    console.error("Guard failed: there must be exactly one READY_TO_PUBLISH row and it must be the selected row.");
    await client.end();
    process.exit(1);
  }

  console.log("Executing single guarded live publish via scripts/publish_one_ready_listing.ts ...");

  execSync("pnpm exec tsx scripts/publish_one_ready_listing.ts", {
    stdio: "inherit",
    env: {
      ...process.env,
      ENABLE_EBAY_LIVE_PUBLISH: "true",
    },
  });

  const finalSelected = await client.query(
    `
      SELECT
        id,
        candidate_id,
        marketplace_key,
        status,
        published_external_id,
        last_publish_error,
        publish_started_ts,
        publish_finished_ts,
        publish_attempt_count,
        listing_date,
        updated_at
      FROM listings
      WHERE id = $1
      LIMIT 1
    `,
    [selectedId]
  );

  console.log("final selected row state:");
  console.table(finalSelected.rows);

  const counts = await client.query(`
    SELECT
      status,
      COUNT(*)::int AS count
    FROM listings
    WHERE marketplace_key = 'ebay'
    GROUP BY status
    ORDER BY status
  `);

  console.log("post-run lifecycle counts:");
  console.table(counts.rows);

  const stale = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status,
      publish_started_ts,
      updated_at
    FROM listings
    WHERE status = 'PUBLISH_IN_PROGRESS'
      AND publish_started_ts < NOW() - INTERVAL '30 minutes'
    ORDER BY publish_started_ts ASC
  `);

  console.log("post-run stale PUBLISH_IN_PROGRESS rows:");
  console.table(stale.rows);
  console.log(`stale in-progress count (30m): ${stale.rows.length}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
