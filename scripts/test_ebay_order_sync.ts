import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { runOrderSyncWorker } = await import("../src/workers/orderSync.worker");

  const limit = Number(process.argv[2] || process.env.ORDER_SYNC_FETCH_LIMIT || "10");
  const lookbackHours = Number(process.argv[3] || process.env.ORDER_SYNC_LOOKBACK_HOURS || "24");

  const result = await runOrderSyncWorker({
    limit,
    lookbackHours,
    actorId: "scripts/test_ebay_order_sync.ts",
  });

  console.log(JSON.stringify({ limit, lookbackHours, result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
