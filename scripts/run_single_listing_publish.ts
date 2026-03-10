import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

function isLivePublishEnabled(): boolean {
  return String(process.env.ENABLE_EBAY_LIVE_PUBLISH ?? "false").trim().toLowerCase() === "true";
}

async function main() {
  const selectedListingId = String(process.argv[2] ?? "").trim();
  const livePublishEnabled = isLivePublishEnabled();

  if (!selectedListingId) {
    console.error("Usage: node scripts/run_single_listing_publish.ts <listing_id>");
    process.exit(1);
  }

  const { runListingExecution } = await import("../src/workers/listingExecute.worker");

  const result = await runListingExecution({
    limit: 1,
    listingId: selectedListingId,
    marketplaceKey: "ebay",
    dryRun: !livePublishEnabled,
    actorId: "run_single_listing_publish.ts",
  });

  console.log(
    JSON.stringify(
      {
        requestedMode: livePublishEnabled ? "live" : "dry-run",
        liveFlag: livePublishEnabled,
        effectiveMode: livePublishEnabled ? "live" : "dry-run",
        selectedListingId,
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
