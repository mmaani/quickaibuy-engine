import { buildAmazonPreview } from "./build_amazon_preview";
import { buildEbayPreview } from "./build_ebay_preview";
import type { ListingPreviewInput, ListingPreviewMarketplace, ListingPreviewOutput } from "./types";

export function buildListingPreview(
  marketplace: ListingPreviewMarketplace,
  input: ListingPreviewInput
): ListingPreviewOutput {
  switch (marketplace) {
    case "ebay":
      return buildEbayPreview(input);
    case "amazon":
      return buildAmazonPreview(input);
    default:
      throw new Error(`Unsupported listing preview marketplace: ${marketplace}`);
  }
}
