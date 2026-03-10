import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";
import { runListingExecution } from "../src/workers/listingExecute.worker";

const { Client } = pg;

async function main() {
  const mode = String(process.argv[2] || "dry-run").trim().toLowerCase();
  const requestedLive = mode === "live";
  const envLiveEnabled = String(process.env.ENABLE_EBAY_LIVE_PUBLISH || "false").trim().toLowerCase() === "true";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const ready = await client.query(`
    SELECT
      id,
      candidate_id,
      marketplace_key,
      status,
      updated_at
    FROM listings
    WHERE marketplace_key = 'ebay'
      AND status = 'READY_TO_PUBLISH'
    ORDER BY updated_at ASC
    LIMIT 1
  `);

  console.log("\nSelected READY_TO_PUBLISH row:");
  console.table(ready.rows);

  await client.end();

  if (ready.rows.length === 0) {
    console.log("No READY_TO_PUBLISH rows found.");
    return;
  }

  const dryRun = !(requestedLive && envLiveEnabled);

  const result = await runListingExecution({
    limit: 1,
    dailyCap: 10,
    marketplaceKey: "ebay",
    dryRun,
    actorId: requestedLive ? "run_single_listing_publish_live" : "run_single_listing_publish_dry_run",
  });

  console.log("\nExecution result:");
  console.log(JSON.stringify({
    requestedMode: mode,
    envLiveEnabled,
    effectiveDryRun: dryRun,
    result,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
