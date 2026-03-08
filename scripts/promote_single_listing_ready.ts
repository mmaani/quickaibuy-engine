import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

import { markListingReadyToPublish } from "../src/lib/listings/markListingReadyToPublish";

async function main() {
  const listingId = String(process.argv[2] || "").trim();

  if (!listingId) {
    throw new Error("listingId argument is required");
  }

  const result = await markListingReadyToPublish({
    listingId,
    actorId: "promote_single_listing_ready",
    actorType: "SYSTEM",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
