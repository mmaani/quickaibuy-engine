import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { runListingExecution } = await import("../src/workers/listingExecute.worker");

  const mode = String(process.argv[2] || "dry-run").trim().toLowerCase();
  const allowLiveArg = mode === "live";
  const liveFlag = String(process.env.ENABLE_EBAY_LIVE_PUBLISH ?? "false").trim().toLowerCase() === "true";
  const effectiveDryRun = !(allowLiveArg && liveFlag);

  if (allowLiveArg && !liveFlag) {
    console.warn("[publish-one-ready-listing] live arg provided but ENABLE_EBAY_LIVE_PUBLISH is false; forcing safe path");
  }

  const result = await runListingExecution({
    limit: 1,
    dailyCap: 1,
    marketplaceKey: "ebay",
    dryRun: effectiveDryRun,
    actorId: "publish_one_ready_listing_direct",
  });

  console.log(
    JSON.stringify(
      {
        requestedMode: mode,
        liveFlag,
        effectiveMode: effectiveDryRun ? "dry-run" : "live",
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
