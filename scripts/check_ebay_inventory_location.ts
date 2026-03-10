import dotenv from "dotenv";
import {
  getEbayPublishEnvValidation,
  getEbaySellAccessToken,
  getInventoryLocations,
} from "@/lib/marketplaces/ebayPublish";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const validation = getEbayPublishEnvValidation();
  if (!validation.config) {
    console.error("eBay publish config is invalid. Run scripts/check_ebay_publish_env.ts first.");
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const config = validation.config;
  const token = await getEbaySellAccessToken(config);
  const locations = await getInventoryLocations(token, config);
  const found = locations.some(
    (location) => location.merchantLocationKey === config.merchantLocationKey
  );

  console.log("Configured merchant location key:");
  console.log(config.merchantLocationKey);
  console.log("");
  console.log("Inventory locations summary:");
  console.table(
    locations.map((location) => ({
      merchantLocationKey: location.merchantLocationKey,
      name: location.name,
      merchantLocationStatus: location.merchantLocationStatus,
      locationTypes: location.locationTypes.join(", "),
    }))
  );

  if (!found) {
    console.error(
      `Configured EBAY_MERCHANT_LOCATION_KEY '${config.merchantLocationKey}' is missing from getInventoryLocations().`
    );
    process.exit(1);
  }

  console.log("Inventory location check passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
