import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { runListingExecution } = await import("../src/workers/listingExecute.worker");

  const liveFlag =
    String(process.env.ENABLE_EBAY_LIVE_PUBLISH ?? "false").trim().toLowerCase() === "true";

  const requestedMode = liveFlag ? "live" : "dry-run";
  const dryRun = !liveFlag;

  const result = await runListingExecution({
    limit: 1,
    marketplaceKey: "ebay",
    dryRun,
    actorId: "publish_one_ready_listing",
  });

  console.log(
    JSON.stringify(
      {
        requestedMode,
        liveFlag,
        effectiveMode: dryRun ? "dry-run" : "live",
        result,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
