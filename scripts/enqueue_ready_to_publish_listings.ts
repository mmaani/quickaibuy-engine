import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

import { enqueueReadyToPublishListings } from "../src/lib/listings/enqueueReadyToPublishListings";

async function main() {
  const limit = Number(process.argv[2] || "10");

  const result = await enqueueReadyToPublishListings({
    limit,
    marketplaceKey: "ebay",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
