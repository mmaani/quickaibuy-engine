export type MarketplaceCandidate = {
  marketplaceKey: "amazon" | "ebay";
  marketplaceListingId: string;
  matchedTitle: string;
  price: number | null;
  shippingPrice: number | null;
  currency: string | null;
  sellerId: string | null;
  sellerName: string | null;
  availabilityStatus: string | null;
  productPageUrl: string | null;
  isPrime: boolean | null;
  rawPayload: unknown;
  searchQuery?: string | null;
  titleSimilarityScore?: number | null;
  keywordScore?: number | null;
  finalMatchScore?: number | null;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

type EbayItemSummary = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  price?: {
    value?: string;
    currency?: string;
  };
  shippingOptions?: Array<{
    shippingCost?: {
      value?: string;
    };
  }>;
  seller?: {
    username?: string;
  };
  estimatedAvailabilities?: Array<{
    estimatedAvailabilityStatus?: string;
  }>;
  itemWebUrl?: string;
};

type EbaySearchResponse = {
  itemSummaries?: EbayItemSummary[];
};

async function getEbayAccessToken(): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET");
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`eBay token failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in ?? 7200) * 1000,
  };

  return cachedToken.token;
}

export async function searchEbay(query: string, limit = 10): Promise<MarketplaceCandidate[]> {
  const token = await getEbayAccessToken();

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.min(limit, 20)));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID || "EBAY_US",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`eBay search failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as EbaySearchResponse;
  const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];

  return items.map((item) => {
    const shipping = Array.isArray(item?.shippingOptions) ? item.shippingOptions[0] : null;

    return {
      marketplaceKey: "ebay",
      marketplaceListingId: String(item?.itemId || item?.legacyItemId || ""),
      matchedTitle: String(item?.title || ""),
      price: item?.price?.value != null ? Number(item.price.value) : null,
      shippingPrice:
        shipping?.shippingCost?.value != null ? Number(shipping.shippingCost.value) : null,
      currency: item?.price?.currency || null,
      sellerId: item?.seller?.username || null,
      sellerName: item?.seller?.username || null,
      availabilityStatus:
        item?.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus || null,
      productPageUrl: item?.itemWebUrl || null,
      isPrime: null,
      rawPayload: item,
      searchQuery: query,
    };
  });
}
