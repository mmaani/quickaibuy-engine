import "dotenv/config";
import { enqueueMarketplacePriceScan } from "@/lib/jobs/enqueueTrendExpand";

async function main() {
  const limit = Number(process.argv[2] || "100");
  const platformArg = String(process.argv[3] || "all").trim().toLowerCase();
  const productRawId = process.argv[4] ? String(process.argv[4]).trim() : undefined;

  const platform =
    platformArg === "amazon" || platformArg === "ebay" ? platformArg : "all";

  const job = await enqueueMarketplacePriceScan({
    limit,
    productRawId,
    platform,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        jobId: job.id,
        name: job.name,
        limit,
        platform,
        productRawId: productRawId ?? null,
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
