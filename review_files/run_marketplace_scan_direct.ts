import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { runTrendMarketplaceScanner } = await import("@/lib/marketplaces/trendMarketplaceScanner");

  const limit = Number(process.argv[2] || "3");
  const platformArg = String(process.argv[3] || "ebay").trim().toLowerCase();
  const productRawId = process.argv[4] ? String(process.argv[4]).trim() : undefined;

  const platform =
    platformArg === "amazon" || platformArg === "ebay" ? platformArg : "all";

  const result = await runTrendMarketplaceScanner({
    limit,
    platform,
    productRawId,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
