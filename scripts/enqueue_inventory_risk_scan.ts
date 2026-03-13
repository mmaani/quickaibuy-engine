import "dotenv/config";
import { enqueueInventoryRiskScan } from "../src/lib/jobs/enqueueInventoryRiskScan";

async function main() {
  const job = await enqueueInventoryRiskScan({
    marketplaceKey: "ebay",
    limit: Number(process.env.INVENTORY_RISK_SCAN_LIMIT ?? 200),
    idempotencySuffix: `manual-${Date.now()}`,
  });

  console.log("Enqueued inventory risk scan job:", job.id, job.name);
  console.log("Consume with: pnpm worker:jobs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
