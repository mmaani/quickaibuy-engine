import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { prepareListingPreviews } = await import("@/lib/listings/prepareListingPreviews");
  const limit = Number(process.argv[2] || "20");
  const marketplace = (process.argv[3] || "ebay") as "ebay" | "amazon";
  const forceRefresh = String(process.argv[4] || "").toLowerCase() === "true";

  const result = await prepareListingPreviews({
    limit,
    marketplace,
    forceRefresh,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
