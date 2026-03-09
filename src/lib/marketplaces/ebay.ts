type EbayShippingOption = {
  shippingCost?: {
    value?: string;
    currency?: string;
  };
};

type EbayEstimatedAvailability = {
  estimatedAvailabilityStatus?: string;
};

type EbaySeller = {
  username?: string;
};

type EbayImage = {
  imageUrl?: string;
};

type EbayItemSummary = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  price?: {
    value?: string;
    currency?: string;
  };
  shippingOptions?: EbayShippingOption[];
  seller?: EbaySeller;
  estimatedAvailabilities?: EbayEstimatedAvailability[];
  itemWebUrl?: string;
  image?: EbayImage;
  thumbnailImages?: EbayImage[];
};

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
  imageUrl: string | null;
  isPrime: boolean | null;
  rawPayload: unknown;
  searchQuery?: string | null;
  titleSimilarityScore?: number | null;
  keywordScore?: number | null;
  finalMatchScore?: number | null;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

function extractLegacyItemId(item: EbayItemSummary): string | null {
  const legacy = item.legacyItemId ? String(item.legacyItemId) : "";
  if (legacy) return legacy;

  const itemId = item.itemId ? String(item.itemId) : "";
  const match = itemId.match(/^v1\|(\d+)\|/);
  return match?.[1] ?? null;
}

function buildEbayProductUrl(item: EbayItemSummary): string | null {
  const direct = item.itemWebUrl ? String(item.itemWebUrl) : "";
  if (direct) return direct;

  const legacyItemId = extractLegacyItemId(item);
  if (!legacyItemId) return null;

  return `https://www.ebay.com/itm/${legacyItemId}`;
}

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

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };

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

  const data = (await res.json()) as {
    itemSummaries?: EbayItemSummary[];
  };

  const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];

  return items.map((item: EbayItemSummary) => {
    const shipping = Array.isArray(item.shippingOptions) ? item.shippingOptions[0] : null;
    const rawItemId = item.itemId ? String(item.itemId) : "";
    const legacyItemId = extractLegacyItemId(item);
    const marketplaceListingId = rawItemId || (legacyItemId ? `v1|${legacyItemId}|0` : "");

    return {
      marketplaceKey: "ebay",
      marketplaceListingId,
      matchedTitle: String(item.title || ""),
      price: item.price?.value != null ? Number(item.price.value) : null,
      shippingPrice:
        shipping?.shippingCost?.value != null ? Number(shipping.shippingCost.value) : null,
      currency: item.price?.currency || null,
      sellerId: item.seller?.username || null,
      sellerName: item.seller?.username || null,
      availabilityStatus:
        item.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus || null,
      productPageUrl: buildEbayProductUrl(item),
      imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
      isPrime: null,
      rawPayload: item,
      searchQuery: query,
    };
  });
}
