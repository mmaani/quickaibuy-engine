export function buildListingPublishIdempotencyKey(input: {
  listingId: string;
  marketplaceKey: "ebay";
}) {
  return `listing-publish:v1:${input.marketplaceKey}:${input.listingId}`;
}
