import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { runListingExecution } = await import("../src/workers/listingExecute.worker");

  const limit = Number(process.argv[2] || "10");
  const mode = String(process.argv[3] || "dry-run").trim().toLowerCase();
  const dryRun = mode !== "live";

  const result = await runListingExecution({
    limit,
    dailyCap: limit,
    marketplaceKey: "ebay",
    dryRun,
    actorId: "run_listing_execution_direct",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
