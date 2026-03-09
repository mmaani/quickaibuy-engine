import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { runListingMonitor } = await import("../src/workers/listingMonitor.worker");
  const limit = Number(process.argv[2] || "20");

  const result = await runListingMonitor({
    limit,
    marketplaceKey: "ebay",
    actorId: "run_listing_monitor_direct",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
