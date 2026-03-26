import { buildAmazonPreview } from "./build_amazon_preview";
import { buildEbayPreview } from "./build_ebay_preview";
import type { ListingPreviewInput, ListingPreviewMarketplace, ListingPreviewOutput } from "./types";

export async function buildListingPreview(
  marketplace: ListingPreviewMarketplace,
  input: ListingPreviewInput
): Promise<ListingPreviewOutput> {
  switch (marketplace) {
    case "ebay":
      return buildEbayPreview(input);
    case "amazon":
      return Promise.resolve(buildAmazonPreview(input));
    default:
      throw new Error(`Unsupported listing preview marketplace: ${marketplace}`);
  }
}
