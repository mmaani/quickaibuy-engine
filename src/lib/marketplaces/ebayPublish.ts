export type EbayListingPayload = {
  id: string;
  marketplaceKey: string;
  idempotencyKey: string | null;
  payload: unknown;
};

export type EbayPublishResult = {
  success: boolean;
  externalListingId: string | null;
  rawResponse: unknown;
  errorMessage: string | null;
};

function parseExternalListingId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const direct = record.listingId ?? record.offerId ?? record.itemId;
  return typeof direct === "string" && direct.trim() ? direct.trim() : null;
}

export async function publishToEbayListing(listing: EbayListingPayload): Promise<EbayPublishResult> {
  if (listing.marketplaceKey !== "ebay") {
    return {
      success: false,
      externalListingId: null,
      rawResponse: null,
      errorMessage: `unsupported publish marketplace: ${listing.marketplaceKey}`,
    };
  }

  if (!listing.idempotencyKey) {
    return {
      success: false,
      externalListingId: null,
      rawResponse: null,
      errorMessage: "missing idempotency key",
    };
  }

  // TODO(v1-live-publish): replace stub with real eBay sell/inventory publish API call.
  // Keep idempotency key in request headers and persist full API response.
  const rawResponse = {
    stub: true,
    marketplace: "ebay",
    listingId: listing.id,
    idempotencyKey: listing.idempotencyKey,
    reason: "eBay live publish adapter boundary is in place; API integration pending",
  };

  const externalListingId = parseExternalListingId(rawResponse);

  return {
    success: false,
    externalListingId,
    rawResponse,
    errorMessage: "live eBay publish adapter is not integrated with eBay API yet",
  };
}
