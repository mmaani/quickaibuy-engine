export type EbayListingPayload = {
  id: string;
  marketplaceKey: string;
  idempotencyKey: string | null;
  payload: unknown;
  price?: string | number | null;
};

export type EbayPublishResult = {
  success: boolean;
  externalListingId: string | null;
  offerId?: string | null;
  inventoryItemKey?: string | null;
  raw?: unknown;
  errorMessage?: string | null;
};

type EbayPublishConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  marketplaceId: string;
  merchantLocationKey: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  fulfillmentPolicyId: string;
  defaultCategoryId: string;
};

type EbayApiErrorShape = {
  errorId?: number;
  domain?: string;
  category?: string;
  message?: string;
  longMessage?: string;
  inputRefIds?: string[];
  parameters?: Array<{ name?: string; value?: string }>;
};

type EbayApiResponse = {
  errors?: EbayApiErrorShape[];
  warnings?: EbayApiErrorShape[];
  [key: string]: unknown;
};

class EbayApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "EbayApiError";
    this.status = status;
    this.body = body;
  }
}

let cachedSellToken: { token: string; expiresAt: number } | null = null;

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractRequiredEnv(): { config: EbayPublishConfig | null; missing: string[] } {
  const values = {
    clientId: stringOrNull(process.env.EBAY_CLIENT_ID),
    clientSecret: stringOrNull(process.env.EBAY_CLIENT_SECRET),
    refreshToken:
      stringOrNull(process.env.EBAY_REFRESH_TOKEN) ||
      stringOrNull(process.env.EBAY_USER_REFRESH_TOKEN),
    marketplaceId: stringOrNull(process.env.EBAY_MARKETPLACE_ID) || "EBAY_US",
    merchantLocationKey:
      stringOrNull(process.env.EBAY_MERCHANT_LOCATION_KEY) ||
      stringOrNull(process.env.EBAY_LOCATION_KEY),
    paymentPolicyId:
      stringOrNull(process.env.EBAY_PAYMENT_POLICY_ID) ||
      stringOrNull(process.env.EBAY_POLICY_PAYMENT_ID),
    returnPolicyId:
      stringOrNull(process.env.EBAY_RETURN_POLICY_ID) ||
      stringOrNull(process.env.EBAY_POLICY_RETURN_ID),
    fulfillmentPolicyId:
      stringOrNull(process.env.EBAY_FULFILLMENT_POLICY_ID) ||
      stringOrNull(process.env.EBAY_POLICY_FULFILLMENT_ID) ||
      stringOrNull(process.env.EBAY_SHIPPING_POLICY_ID),
    defaultCategoryId:
      stringOrNull(process.env.EBAY_DEFAULT_CATEGORY_ID) ||
      stringOrNull(process.env.EBAY_CATEGORY_ID),
  };

  const missing: string[] = [];

  if (!values.clientId) missing.push("EBAY_CLIENT_ID");
  if (!values.clientSecret) missing.push("EBAY_CLIENT_SECRET");
  if (!values.refreshToken) missing.push("EBAY_REFRESH_TOKEN (or EBAY_USER_REFRESH_TOKEN)");
  if (!values.marketplaceId) missing.push("EBAY_MARKETPLACE_ID");
  if (!values.merchantLocationKey) missing.push("EBAY_MERCHANT_LOCATION_KEY (or EBAY_LOCATION_KEY)");
  if (!values.paymentPolicyId) missing.push("EBAY_PAYMENT_POLICY_ID (or EBAY_POLICY_PAYMENT_ID)");
  if (!values.returnPolicyId) missing.push("EBAY_RETURN_POLICY_ID (or EBAY_POLICY_RETURN_ID)");
  if (!values.fulfillmentPolicyId)
    missing.push("EBAY_FULFILLMENT_POLICY_ID (or EBAY_POLICY_FULFILLMENT_ID / EBAY_SHIPPING_POLICY_ID)");
  if (!values.defaultCategoryId) missing.push("EBAY_DEFAULT_CATEGORY_ID (or EBAY_CATEGORY_ID)");

  if (missing.length > 0) {
    return { config: null, missing };
  }

  return {
    config: {
      clientId: values.clientId!,
      clientSecret: values.clientSecret!,
      refreshToken: values.refreshToken!,
      marketplaceId: values.marketplaceId!,
      merchantLocationKey: values.merchantLocationKey!,
      paymentPolicyId: values.paymentPolicyId!,
      returnPolicyId: values.returnPolicyId!,
      fulfillmentPolicyId: values.fulfillmentPolicyId!,
      defaultCategoryId: values.defaultCategoryId!,
    },
    missing,
  };
}

async function readApiBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await res.json();
  }
  return await res.text();
}

function formatApiErrors(body: unknown): string {
  const obj = objectOrNull(body);
  const errors = Array.isArray(obj?.errors) ? (obj?.errors as EbayApiErrorShape[]) : [];
  if (errors.length === 0) {
    if (typeof body === "string") return body;
    return "unknown eBay API error";
  }

  return errors
    .map((e) => `${e.errorId ?? "?"}: ${e.longMessage || e.message || "unknown"}`)
    .join(" | ");
}

async function ebayJsonRequest(
  url: string,
  init: RequestInit,
  context: string
): Promise<EbayApiResponse> {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
  });

  const body = await readApiBody(res);

  if (!res.ok) {
    throw new EbayApiError(`eBay ${context} failed: ${res.status} ${formatApiErrors(body)}`, res.status, body);
  }

  return objectOrNull(body) ?? { raw: body };
}

async function getEbaySellAccessToken(config: EbayPublishConfig): Promise<string> {
  const now = Date.now();
  if (cachedSellToken && cachedSellToken.expiresAt > now + 60_000) {
    return cachedSellToken.token;
  }

  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const scope =
    "https://api.ebay.com/oauth/api_scope/sell.inventory " +
    "https://api.ebay.com/oauth/api_scope/sell.account";

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      scope,
    }),
    cache: "no-store",
  });

  const body = await readApiBody(res);

  if (!res.ok) {
    throw new EbayApiError(`eBay token refresh failed: ${res.status} ${formatApiErrors(body)}`, res.status, body);
  }

  const parsed = objectOrNull(body) ?? {};
  const token = stringOrNull(parsed.access_token);
  const expiresIn = Number(parsed.expires_in ?? 7200);

  if (!token) {
    throw new Error("eBay token refresh returned no access_token");
  }

  cachedSellToken = {
    token,
    expiresAt: now + expiresIn * 1000,
  };

  return token;
}

function safeSku(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "-");
  const bounded = cleaned.slice(0, 50);
  return bounded || `qab-${Date.now()}`;
}

function buildDescription(payload: Record<string, unknown>, title: string): string {
  const source = objectOrNull(payload.source) ?? {};
  const economics = objectOrNull(payload.economics) ?? {};

  const supplierTitle = stringOrNull(source.supplierTitle);
  const supplierUrl = stringOrNull(source.supplierSourceUrl);
  const supplierKey = stringOrNull(source.supplierKey);
  const supplierProductId = stringOrNull(source.supplierProductId);

  const estimatedProfit = numberOrNull(economics.estimatedProfit);
  const marginPct = numberOrNull(economics.marginPct);
  const roiPct = numberOrNull(economics.roiPct);

  const lines = [
    title,
    supplierTitle ? `Source title: ${supplierTitle}` : null,
    supplierKey && supplierProductId ? `Source: ${supplierKey}/${supplierProductId}` : null,
    supplierUrl ? `Source URL: ${supplierUrl}` : null,
    estimatedProfit != null ? `Estimated profit: ${estimatedProfit.toFixed(2)} USD` : null,
    marginPct != null ? `Estimated margin: ${marginPct.toFixed(2)}%` : null,
    roiPct != null ? `Estimated ROI: ${roiPct.toFixed(2)}%` : null,
    "Prepared by QuickAIBuy guarded v1 publish flow.",
  ].filter(Boolean) as string[];

  return lines.join("\n").slice(0, 4000);
}

function extractImageUrls(payload: Record<string, unknown>): string[] {
  const images: string[] = [];
  const source = objectOrNull(payload.source) ?? {};
  const supplierImage = stringOrNull(source.supplierImageUrl);

  if (supplierImage) {
    images.push(supplierImage);
  }

  const rawImages = payload.images;
  if (Array.isArray(rawImages)) {
    for (const entry of rawImages) {
      const url = stringOrNull(entry);
      if (url) images.push(url);
    }
  }

  return [...new Set(images)].slice(0, 12);
}

function parseExternalListingId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const candidates = [
    record.listingId,
    record.itemId,
    record.externalListingId,
    record.offerId,
    record.inventoryReferenceId,
  ];

  for (const c of candidates) {
    const asString = stringOrNull(c);
    if (asString) return asString;
  }

  return null;
}

async function findExistingOfferIdBySku(
  token: string,
  config: EbayPublishConfig,
  sku: string
): Promise<string | null> {
  const url = new URL("https://api.ebay.com/sell/inventory/v1/offer");
  url.searchParams.set("sku", sku);
  url.searchParams.set("marketplace_id", config.marketplaceId);
  url.searchParams.set("format", "FIXED_PRICE");

  const body = await ebayJsonRequest(
    url.toString(),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
    "offer lookup"
  );

  const offers = Array.isArray(body.offers) ? (body.offers as Array<Record<string, unknown>>) : [];
  for (const offer of offers) {
    const offerId = stringOrNull(offer.offerId);
    if (offerId) return offerId;
  }

  return null;
}

function isDuplicateOfferError(body: unknown): boolean {
  const obj = objectOrNull(body);
  const errors = Array.isArray(obj?.errors) ? (obj?.errors as EbayApiErrorShape[]) : [];
  return errors.some((e) => String(e.errorId ?? "") === "25018" || /offer/i.test(String(e.message ?? "")));
}

export async function publishToEbayListing(listing: EbayListingPayload): Promise<EbayPublishResult> {
  if (listing.marketplaceKey !== "ebay") {
    return {
      success: false,
      externalListingId: null,
      raw: null,
      errorMessage: `unsupported publish marketplace: ${listing.marketplaceKey}`,
    };
  }

  if (!listing.idempotencyKey) {
    return {
      success: false,
      externalListingId: null,
      raw: null,
      errorMessage: "missing idempotency key",
    };
  }

  const { config, missing } = extractRequiredEnv();
  if (!config) {
    return {
      success: false,
      externalListingId: null,
      raw: { missingEnv: missing },
      errorMessage: `missing required eBay publish env/config: ${missing.join(", ")}`,
    };
  }

  const payload = objectOrNull(listing.payload) ?? {};
  const title = stringOrNull(payload.title) ?? `QuickAIBuy Listing ${listing.id}`;
  const price = numberOrNull(payload.price) ?? numberOrNull(listing.price) ?? null;
  const quantity = Math.max(1, Math.floor(numberOrNull(payload.quantity) ?? 1));

  if (price == null || price <= 0) {
    return {
      success: false,
      externalListingId: null,
      raw: { payload },
      errorMessage: "listing payload price is missing or invalid for eBay publish",
    };
  }

  const inventoryItemKey = safeSku(`qab-${listing.id}`);
  const imageUrls = extractImageUrls(payload);
  const description = buildDescription(payload, title);

  const raw: Record<string, unknown> = {
    inventoryItemKey,
  };

  try {
    const token = await getEbaySellAccessToken(config);

    const inventoryResponse = await ebayJsonRequest(
      `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(inventoryItemKey)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
        body: JSON.stringify({
          sku: inventoryItemKey,
          availability: {
            shipToLocationAvailability: {
              quantity,
            },
          },
          condition: String(payload.condition ?? "NEW"),
          product: {
            title,
            description,
            imageUrls,
            aspects: {
              Brand: ["Unbranded"],
              MPN: ["Does Not Apply"],
            },
          },
        }),
      },
      "inventory item upsert"
    );
    raw.inventory = inventoryResponse;

    let offerResponse: EbayApiResponse | null = null;
    let offerId: string | null = null;

    try {
      offerResponse = await ebayJsonRequest(
        "https://api.ebay.com/sell/inventory/v1/offer",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Content-Language": "en-US",
          },
          body: JSON.stringify({
            sku: inventoryItemKey,
            marketplaceId: config.marketplaceId,
            format: "FIXED_PRICE",
            availableQuantity: quantity,
            categoryId: config.defaultCategoryId,
            merchantLocationKey: config.merchantLocationKey,
            listingDescription: description,
            pricingSummary: {
              price: {
                value: Number(price.toFixed(2)).toFixed(2),
                currency: "USD",
              },
            },
            listingPolicies: {
              fulfillmentPolicyId: config.fulfillmentPolicyId,
              paymentPolicyId: config.paymentPolicyId,
              returnPolicyId: config.returnPolicyId,
            },
            quantityLimitPerBuyer: 1,
          }),
        },
        "offer create"
      );
      raw.offerCreate = offerResponse;
      offerId = stringOrNull(offerResponse.offerId);
    } catch (err) {
      if (err instanceof EbayApiError && isDuplicateOfferError(err.body)) {
        raw.offerCreateError = err.body;
        offerId = await findExistingOfferIdBySku(token, config, inventoryItemKey);
        raw.offerLookup = { offerId };
      } else {
        throw err;
      }
    }

    if (!offerId) {
      return {
        success: false,
        externalListingId: null,
        offerId: null,
        inventoryItemKey,
        raw,
        errorMessage: "unable to resolve eBay offerId after create/lookup",
      };
    }

    const publishResponse = await ebayJsonRequest(
      `https://api.ebay.com/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      },
      "offer publish"
    );

    raw.offerPublish = publishResponse;

    const externalListingId = parseExternalListingId(publishResponse);

    if (!externalListingId) {
      return {
        success: false,
        externalListingId: null,
        offerId,
        inventoryItemKey,
        raw,
        errorMessage: "eBay publish did not return an external listing id",
      };
    }

    return {
      success: true,
      externalListingId,
      offerId,
      inventoryItemKey,
      raw,
      errorMessage: null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorRaw = err instanceof EbayApiError ? err.body : { error: err };

    return {
      success: false,
      externalListingId: null,
      offerId: null,
      inventoryItemKey,
      raw: {
        ...raw,
        error: errorRaw,
      },
      errorMessage,
    };
  }
}
