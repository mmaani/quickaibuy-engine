import dotenv from "dotenv";
import { getEbayPublishEnvValidation } from "@/lib/marketplaces/ebayPublish";

dotenv.config({ path: ".env.local" });
dotenv.config();

function main() {
  const validation = getEbayPublishEnvValidation();

  console.log("eBay live publish env summary (redacted):");
  console.table(validation.redacted);
  console.log("Resolved public URLs:");
  console.table(validation.publicUrls);

  if (!validation.ok) {
    console.error("eBay live publish env validation failed:");
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("eBay live publish env validation passed.");
}

main();
