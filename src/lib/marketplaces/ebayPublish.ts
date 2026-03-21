import { normalizeWarehouseCountry } from "@/lib/marketplaces/ebay/normalizeWarehouseCountry";

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

export type EbayPublishConfig = {
  websiteUrl: string;
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

export type EbayInventoryLocationSummary = {
  merchantLocationKey: string;
  name: string | null;
  merchantLocationStatus: string | null;
  locationTypes: string[];
  country: string | null;
  city: string | null;
  stateOrProvince: string | null;
};

export type EbayPublishEnvValidation = {
  ok: boolean;
  errors: string[];
  config: EbayPublishConfig | null;
  redacted: Record<string, string | null>;
  publicUrls: {
    privacyPolicyUrl: string | null;
    authAcceptedUrl: string | null;
    authDeclinedUrl: string | null;
  };
};

export type EbayPublishPreflightResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  shipFromCountry: string | null;
  resolvedMerchantLocationKey: string | null;
  resolvedMerchantLocationSource: "configured-default" | "auto-country-match" | null;
  config: EbayPublishConfig | null;
  publicUrls: {
    privacyPolicyUrl: string | null;
    authAcceptedUrl: string | null;
    authDeclinedUrl: string | null;
  };
  inventoryLocationFound: boolean;
  inventoryLocations: EbayInventoryLocationSummary[];
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

const EBAY_SELL_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory " +
  "https://api.ebay.com/oauth/api_scope/sell.account " +
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment";

let cachedSellToken: { token: string; expiresAt: number } | null = null;
const EBAY_LANGUAGE_HEADER = "en-US";

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

function redactSecret(value: string | null): string | null {
  if (!value) return null;
  return `set(len=${value.length})`;
}

function normalizeWebsiteUrl(input: string | null): string | null {
  const candidate = input ?? "https://quickaibuy.com";
  try {
    const parsed = new URL(candidate);
    if (!parsed.protocol || !parsed.hostname) return null;
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function buildPublicUrls(websiteUrl: string | null): {
  privacyPolicyUrl: string | null;
  authAcceptedUrl: string | null;
  authDeclinedUrl: string | null;
} {
  if (!websiteUrl) {
    return {
      privacyPolicyUrl: null,
      authAcceptedUrl: null,
      authDeclinedUrl: null,
    };
  }
  return {
    privacyPolicyUrl: `${websiteUrl}/privacy`,
    authAcceptedUrl: `${websiteUrl}/ebay/auth/accepted`,
    authDeclinedUrl: `${websiteUrl}/ebay/auth/declined`,
  };
}

function parseTokenError(body: unknown): { code: string | null; description: string | null } {
  const parsed = objectOrNull(body) ?? {};
  return {
    code: stringOrNull(parsed.error),
    description: stringOrNull(parsed.error_description),
  };
}

function buildEbayPublishConfigValidation(): EbayPublishEnvValidation {
  const values = {
    websiteUrl: normalizeWebsiteUrl(stringOrNull(process.env.WEBSITE_URL)),
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

  const errors: string[] = [];
  const publicUrls = buildPublicUrls(values.websiteUrl);

  if (!values.websiteUrl) {
    errors.push(
      "Missing or invalid WEBSITE_URL. Set WEBSITE_URL to your public site origin, for example https://quickaibuy.com."
    );
  }

  if (!values.clientId) {
    errors.push("Missing EBAY_CLIENT_ID. Set your eBay app client ID for live publish.");
  }
  if (!values.clientSecret) {
    errors.push("Missing EBAY_CLIENT_SECRET. Set your eBay app client secret for live publish.");
  }
  if (!values.refreshToken) {
    errors.push(
      "Missing EBAY_REFRESH_TOKEN (or EBAY_USER_REFRESH_TOKEN). Generate a user refresh token with sell scopes."
    );
  } else if (values.refreshToken.length < 20) {
    errors.push(
      "Invalid EBAY_REFRESH_TOKEN: value is too short to be a valid eBay refresh token. Re-generate and store the full token."
    );
  }
  if (!values.merchantLocationKey) {
    errors.push(
      "Missing EBAY_MERCHANT_LOCATION_KEY (or EBAY_LOCATION_KEY). Configure the seller base inventory location key in eBay."
    );
  }

  if (!values.paymentPolicyId) {
    errors.push("Missing EBAY_PAYMENT_POLICY_ID (or EBAY_POLICY_PAYMENT_ID).");
  } else if (!/^\d+$/.test(values.paymentPolicyId)) {
    errors.push("Invalid EBAY_PAYMENT_POLICY_ID: expected numeric policy ID string.");
  }

  if (!values.returnPolicyId) {
    errors.push("Missing EBAY_RETURN_POLICY_ID (or EBAY_POLICY_RETURN_ID).");
  } else if (!/^\d+$/.test(values.returnPolicyId)) {
    errors.push("Invalid EBAY_RETURN_POLICY_ID: expected numeric policy ID string.");
  }

  if (!values.fulfillmentPolicyId) {
    errors.push(
      "Missing EBAY_FULFILLMENT_POLICY_ID (or EBAY_POLICY_FULFILLMENT_ID / EBAY_SHIPPING_POLICY_ID)."
    );
  } else if (!/^\d+$/.test(values.fulfillmentPolicyId)) {
    errors.push("Invalid EBAY_FULFILLMENT_POLICY_ID: expected numeric policy ID string.");
  }

  if (!values.defaultCategoryId) {
    errors.push("Missing EBAY_DEFAULT_CATEGORY_ID (or EBAY_CATEGORY_ID).");
  } else if (!/^\d+$/.test(values.defaultCategoryId)) {
    errors.push("Invalid EBAY_DEFAULT_CATEGORY_ID: expected numeric eBay category ID string.");
  }

  if (!values.marketplaceId) {
    errors.push("Missing EBAY_MARKETPLACE_ID.");
  }

  const config: EbayPublishConfig | null = errors.length
    ? null
    : {
        clientId: values.clientId!,
        clientSecret: values.clientSecret!,
        websiteUrl: values.websiteUrl!,
        refreshToken: values.refreshToken!,
        marketplaceId: values.marketplaceId!,
        merchantLocationKey: values.merchantLocationKey!,
        paymentPolicyId: values.paymentPolicyId!,
        returnPolicyId: values.returnPolicyId!,
        fulfillmentPolicyId: values.fulfillmentPolicyId!,
        defaultCategoryId: values.defaultCategoryId!,
      };

  return {
    ok: errors.length === 0,
    errors,
    config,
    redacted: {
      EBAY_CLIENT_ID: values.clientId,
      WEBSITE_URL: values.websiteUrl,
      EBAY_CLIENT_SECRET: redactSecret(values.clientSecret),
      EBAY_REFRESH_TOKEN: redactSecret(values.refreshToken),
      EBAY_MARKETPLACE_ID: values.marketplaceId,
      EBAY_MERCHANT_LOCATION_KEY: values.merchantLocationKey,
      EBAY_PAYMENT_POLICY_ID: values.paymentPolicyId,
      EBAY_RETURN_POLICY_ID: values.returnPolicyId,
      EBAY_FULFILLMENT_POLICY_ID: values.fulfillmentPolicyId,
      EBAY_DEFAULT_CATEGORY_ID: values.defaultCategoryId,
      ENABLE_EBAY_LIVE_PUBLISH: stringOrNull(process.env.ENABLE_EBAY_LIVE_PUBLISH) ?? "false",
      PRIVACY_POLICY_URL: publicUrls.privacyPolicyUrl,
      EBAY_AUTH_ACCEPTED_URL: publicUrls.authAcceptedUrl,
      EBAY_AUTH_DECLINED_URL: publicUrls.authDeclinedUrl,
    },
    publicUrls,
  };
}

export function sanitizeEbayPayload(payload: unknown): Record<string, unknown> {
  const raw = objectOrNull(payload) ?? {};
  const source = objectOrNull(raw.source) ?? {};
  const matchedMarketplace = objectOrNull(raw.matchedMarketplace) ?? {};
  const economics = objectOrNull(raw.economics) ?? {};

  const cleanedSource: Record<string, unknown> = {
    candidateId: stringOrNull(source.candidateId),
    supplierKey: stringOrNull(source.supplierKey),
    supplierProductId: stringOrNull(source.supplierProductId),
    supplierWarehouseCountry:
      stringOrNull(source.supplierWarehouseCountry) ?? stringOrNull(source.shipFromCountry),
    supplierImageUrl: stringOrNull(source.supplierImageUrl),
  };

  const cleanedMatchedMarketplace: Record<string, unknown> = {
    marketplaceKey: stringOrNull(matchedMarketplace.marketplaceKey),
    marketplacePrice: numberOrNull(matchedMarketplace.marketplacePrice),
    marketplaceListingId: stringOrNull(matchedMarketplace.marketplaceListingId),
    marketplaceTitle: stringOrNull(matchedMarketplace.marketplaceTitle),
  };

  const cleanedEconomics: Record<string, unknown> = {
    estimatedProfit: numberOrNull(economics.estimatedProfit),
    marginPct: numberOrNull(economics.marginPct),
    roiPct: numberOrNull(economics.roiPct),
  };

  const description = stringOrNull(raw.description);
  const sanitizedDescription = description
    ? description.replace(/https?:\/\/[^\s]+/gi, "").replace(/\btemu\b/gi, "").trim()
    : null;

  const cleaned: Record<string, unknown> = {
    marketplace: stringOrNull(raw.marketplace),
    listingType: stringOrNull(raw.listingType),
    title: stringOrNull(raw.title),
    subtitle: stringOrNull(raw.subtitle),
    description: sanitizedDescription,
    condition: stringOrNull(raw.condition),
    brand: stringOrNull(raw.brand),
    mpn: stringOrNull(raw.mpn),
    categoryId: stringOrNull(raw.categoryId),
    shipFromCountry: stringOrNull(raw.shipFromCountry),
    price: numberOrNull(raw.price),
    quantity: numberOrNull(raw.quantity),
    images: Array.isArray(raw.images)
      ? raw.images.map((x) => stringOrNull(x)).filter(Boolean)
      : [],
    source: cleanedSource,
    matchedMarketplace: cleanedMatchedMarketplace,
    economics: cleanedEconomics,
  };

  return cleaned;
}

export function getEbayPublishEnvValidation(): EbayPublishEnvValidation {
  return buildEbayPublishConfigValidation();
}

function requireEbayPublishConfig(): EbayPublishConfig {
  const validation = buildEbayPublishConfigValidation();
  if (!validation.config) {
    throw new Error(`eBay live publish config invalid: ${validation.errors.join(" | ")}`);
  }
  return validation.config;
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
  const errors = Array.isArray(obj?.errors) ? (obj.errors as EbayApiErrorShape[]) : [];
  if (errors.length === 0) {
    const tokenErr = parseTokenError(body);
    if (tokenErr.code) {
      return [tokenErr.code, tokenErr.description].filter(Boolean).join(": ");
    }
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
  const baseHeaders: Record<string, string> = {
    "Accept-Language": EBAY_LANGUAGE_HEADER,
    "Content-Language": EBAY_LANGUAGE_HEADER,
  };
  const mergedHeaders = {
    ...baseHeaders,
    ...(init.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...init,
    headers: mergedHeaders,
    cache: "no-store",
  });

  const body = await readApiBody(res);

  if (!res.ok) {
    throw new EbayApiError(`eBay ${context} failed: ${res.status} ${formatApiErrors(body)}`, res.status, body);
  }

  return objectOrNull(body) ?? { raw: body };
}

export async function getEbaySellAccessToken(configInput?: EbayPublishConfig): Promise<string> {
  const config = configInput ?? requireEbayPublishConfig();
  if (!config.refreshToken) {
    throw new Error("eBay token refresh requires EBAY_REFRESH_TOKEN (or EBAY_USER_REFRESH_TOKEN).");
  }

  const now = Date.now();
  if (cachedSellToken && cachedSellToken.expiresAt > now + 60_000) {
    return cachedSellToken.token;
  }

  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      scope: EBAY_SELL_SCOPE,
    }),
    cache: "no-store",
  });

  const body = await readApiBody(res);

  if (!res.ok) {
    const tokenErr = parseTokenError(body);
    if (tokenErr.code === "invalid_client") {
      throw new Error(
        "eBay token refresh failed: invalid_client. Verify EBAY_CLIENT_ID and EBAY_CLIENT_SECRET for the active eBay app."
      );
    }
    if (tokenErr.code === "invalid_scope") {
      throw new Error(
        "eBay token refresh failed: invalid_scope. Ensure the refresh token was granted sell.inventory/sell.account/sell.fulfillment scopes."
      );
    }
    if (tokenErr.code === "invalid_grant") {
      throw new Error(
        "eBay token refresh failed: invalid_grant. Refresh EBAY_REFRESH_TOKEN because it is expired, revoked, or mismatched to this app."
      );
    }

    throw new EbayApiError(`eBay token refresh failed: ${res.status} ${formatApiErrors(body)}`, res.status, body);
  }

  const parsed = objectOrNull(body) ?? {};
  const token = stringOrNull(parsed.access_token);
  const expiresIn = numberOrNull(parsed.expires_in);

  if (!token) {
    throw new Error("eBay token refresh returned malformed response: missing access_token.");
  }

  if (expiresIn == null || expiresIn <= 0) {
    throw new Error("eBay token refresh returned malformed response: invalid expires_in.");
  }

  cachedSellToken = {
    token,
    expiresAt: now + expiresIn * 1000,
  };

  return token;
}

function summarizeInventoryLocation(entry: unknown): EbayInventoryLocationSummary | null {
  const item = objectOrNull(entry);
  if (!item) return null;

  const merchantLocationKey = stringOrNull(item.merchantLocationKey);
  if (!merchantLocationKey) return null;
  const location = objectOrNull(item.location);
  const address = objectOrNull(location?.address);

  return {
    merchantLocationKey,
    name: stringOrNull(item.name),
    merchantLocationStatus: stringOrNull(item.merchantLocationStatus),
    locationTypes: Array.isArray(item.locationTypes)
      ? item.locationTypes.map((value) => String(value)).filter(Boolean)
      : [],
    country: stringOrNull(address?.country),
    city: stringOrNull(address?.city),
    stateOrProvince: stringOrNull(address?.stateOrProvince),
  };
}

function normalizeLocationCountry(value: string | null | undefined): string | null {
  return normalizeWarehouseCountry(value ?? null);
}

function isEnabledInventoryLocation(location: EbayInventoryLocationSummary): boolean {
  return String(location.merchantLocationStatus ?? "").toUpperCase() !== "DISABLED";
}

function resolveMerchantLocationForShipFromCountry(input: {
  config: EbayPublishConfig;
  shipFromCountry: string | null;
  inventoryLocations: EbayInventoryLocationSummary[];
}): {
  merchantLocationKey: string | null;
  source: "configured-default" | "auto-country-match" | null;
  error?: string;
} {
  if (!input.shipFromCountry) {
    return {
      merchantLocationKey: null,
      source: null,
      error: "Missing normalized supplier ship-from country.",
    };
  }

  const normalizedShipFromCountry = normalizeLocationCountry(input.shipFromCountry);
  if (!normalizedShipFromCountry) {
    return {
      merchantLocationKey: null,
      source: null,
      error: `Unsupported supplier ship-from country '${input.shipFromCountry}'.`,
    };
  }

  const activeLocations = input.inventoryLocations.filter(isEnabledInventoryLocation);
  const configuredLocation =
    activeLocations.find((location) => location.merchantLocationKey === input.config.merchantLocationKey) ?? null;
  const configuredCountry = normalizeLocationCountry(configuredLocation?.country);

  if (configuredLocation && configuredCountry === normalizedShipFromCountry) {
    return {
      merchantLocationKey: configuredLocation.merchantLocationKey,
      source: "configured-default",
    };
  }

  const matchingLocations = activeLocations.filter(
    (location) => normalizeLocationCountry(location.country) === normalizedShipFromCountry
  );

  if (matchingLocations.length === 1) {
    return {
      merchantLocationKey: matchingLocations[0].merchantLocationKey,
      source: "auto-country-match",
    };
  }

  if (matchingLocations.length === 0) {
    return {
      merchantLocationKey: null,
      source: null,
      error: configuredLocation
        ? `Configured EBAY_MERCHANT_LOCATION_KEY '${input.config.merchantLocationKey}' resolves to ${configuredCountry ?? "unknown"}, but supplier ship-from country is ${normalizedShipFromCountry}. Create or enable a seller inventory location for ${normalizedShipFromCountry} before live publish.`
        : `No enabled seller inventory location matches supplier ship-from country ${normalizedShipFromCountry}. Create or enable a seller inventory location for that country before live publish.`,
    };
  }

  return {
    merchantLocationKey: null,
    source: null,
    error: `Multiple enabled eBay inventory locations match supplier ship-from country ${normalizedShipFromCountry}. Keep one canonical location or extend runtime mapping before live publish.`,
  };
}

export async function getInventoryLocations(
  tokenInput?: string,
  configInput?: EbayPublishConfig
): Promise<EbayInventoryLocationSummary[]> {
  const config = configInput ?? requireEbayPublishConfig();
  const token = tokenInput ?? (await getEbaySellAccessToken(config));

  const body = await ebayJsonRequest(
    "https://api.ebay.com/sell/inventory/v1/location?limit=200",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
    "inventory locations lookup"
  );

  const locationsRaw = Array.isArray(body.locations) ? body.locations : [];
  const locations: EbayInventoryLocationSummary[] = [];

  for (const entry of locationsRaw) {
    const summary = summarizeInventoryLocation(entry);
    if (summary) locations.push(summary);
  }

  return locations;
}

function safeSku(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "-");
  const bounded = cleaned.slice(0, 50);
  return bounded || `qab-${Date.now()}`;
}

function buildDescription(payload: Record<string, unknown>, title: string): string {
  const features: string[] = [];

  const matchedMarketplace = objectOrNull(payload.matchedMarketplace) ?? {};
  const matchedTitle = stringOrNull(matchedMarketplace.marketplaceTitle);

  if (matchedTitle && matchedTitle !== title) {
    features.push(matchedTitle);
  }

  const lines = [
    title,
    "",
    "Key features:",
    features.length > 0 ? `- ${features.join("\n- ")}` : "- Compact and practical design\n- Everyday-use convenience\n- Ready for immediate dispatch",
    "",
    "Package includes:",
    "- 1 item",
    "",
    "Condition: New",
  ];

  return lines.join("\n").slice(0, 4000);
}

function extractImageUrls(payload: Record<string, unknown>): string[] {
  const images: string[] = [];
  const source = objectOrNull(payload.source) ?? {};
  const supplierImage = stringOrNull(source.supplierImageUrl);

  const rawImages = payload.images;
  if (Array.isArray(rawImages)) {
    for (const entry of rawImages) {
      const url = stringOrNull(entry);
      if (url) images.push(url);
    }
  }

  if (images.length === 0 && supplierImage) {
    images.push(supplierImage);
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
  const errors = Array.isArray(obj?.errors) ? (obj.errors as EbayApiErrorShape[]) : [];
  return errors.some((e) => String(e.errorId ?? "") === "25018" || /offer/i.test(String(e.message ?? "")));
}

function resolveShipFromCountry(payload: Record<string, unknown>): string | null {
  const source = objectOrNull(payload.source) ?? {};
  const preferred =
    stringOrNull(payload.shipFromCountry) ??
    stringOrNull(source.supplierWarehouseCountry) ??
    stringOrNull(source.shipFromCountry);

  return normalizeWarehouseCountry(preferred);
}

function resolveCategoryId(payload: Record<string, unknown>, config: EbayPublishConfig): string {
  const payloadCategoryId = stringOrNull(payload.categoryId);
  if (payloadCategoryId && /^\d+$/.test(payloadCategoryId)) {
    return payloadCategoryId;
  }
  return config.defaultCategoryId;
}

export async function validateEbayPublishPreflight(payloadInput: unknown): Promise<EbayPublishPreflightResult> {
  const payload = sanitizeEbayPayload(payloadInput);
  const shipFromCountry = resolveShipFromCountry(payload);

  const envValidation = buildEbayPublishConfigValidation();
  const errors = [...envValidation.errors];
  const warnings: string[] = [];
  let resolvedMerchantLocationKey: string | null = null;
  let resolvedMerchantLocationSource: "configured-default" | "auto-country-match" | null = null;

  if (!shipFromCountry) {
    errors.push(
      "Missing normalized supplier ship-from country. Provide supplier_warehouse_country (preferred) or ship_from_country so eBay publish can set item origin explicitly."
    );
  }

  let inventoryLocationFound = false;
  let inventoryLocations: EbayInventoryLocationSummary[] = [];

  if (envValidation.config && errors.length === 0) {
    try {
      const config = envValidation.config;
      const token = await getEbaySellAccessToken(config);
      inventoryLocations = await getInventoryLocations(token, config);
      inventoryLocationFound = inventoryLocations.some(
        (location) => location.merchantLocationKey === config.merchantLocationKey
      );

      if (!inventoryLocationFound) {
        errors.push(
          `Configured EBAY_MERCHANT_LOCATION_KEY '${config.merchantLocationKey}' was not found in seller inventory locations. Run scripts/check_ebay_inventory_location.ts and fix eBay account setup.`
        );
      } else {
        const merchantLocation = resolveMerchantLocationForShipFromCountry({
          config,
          shipFromCountry,
          inventoryLocations,
        });

        resolvedMerchantLocationKey = merchantLocation.merchantLocationKey;
        resolvedMerchantLocationSource = merchantLocation.source;

        if (merchantLocation.error) {
          errors.push(merchantLocation.error);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Unable to validate eBay inventory locations: ${message}`);
    }
  }

  if (envValidation.config && !inventoryLocations.length) {
    warnings.push(
      "No inventory locations were returned from eBay during preflight. Verify seller account inventory-location setup."
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    shipFromCountry,
    resolvedMerchantLocationKey,
    resolvedMerchantLocationSource,
    config: envValidation.config,
    publicUrls: envValidation.publicUrls,
    inventoryLocationFound,
    inventoryLocations,
  };
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

  const payload = sanitizeEbayPayload(listing.payload);
  const preflight = await validateEbayPublishPreflight(payload);

  if (!preflight.ok || !preflight.config) {
    return {
      success: false,
      externalListingId: null,
      raw: {
        preflight,
      },
      errorMessage: `eBay live publish preflight failed: ${preflight.errors.join(" | ")}`,
    };
  }

  const config = preflight.config;
  const title = stringOrNull(payload.title) ?? `QuickAIBuy Listing ${listing.id}`;
  const price = numberOrNull(payload.price) ?? numberOrNull(listing.price) ?? null;
  const quantity = Math.max(1, Math.floor(numberOrNull(payload.quantity) ?? 1));
  const shipFromCountry = preflight.shipFromCountry;
  const merchantLocationKey = preflight.resolvedMerchantLocationKey;

  if (price == null || price <= 0) {
    return {
      success: false,
      externalListingId: null,
      raw: { payload },
      errorMessage: "listing payload price is missing or invalid for eBay publish",
    };
  }

  if (!shipFromCountry) {
    return {
      success: false,
      externalListingId: null,
      raw: { payload },
      errorMessage:
        "supplier ship-from country is unknown. Refusing live publish instead of guessing seller base country.",
    };
  }

  if (!merchantLocationKey) {
    return {
      success: false,
      externalListingId: null,
      raw: { payload, preflight },
      errorMessage:
        "eBay merchant location could not be resolved for the supplier ship-from country. Refusing live publish instead of using a mismatched seller location.",
    };
  }

  const inventoryItemKey = safeSku(`qab-${listing.id}`);
  const imageUrls = extractImageUrls(payload);
  const description = buildDescription(payload, title);
  const categoryId = resolveCategoryId(payload, config);

  const raw: Record<string, unknown> = {
    inventoryItemKey,
    shipFromCountry,
    sanitizedPayload: payload,
    publishInput: {
      marketplaceId: config.marketplaceId,
      merchantLocationKey,
      categoryId,
      paymentPolicyId: config.paymentPolicyId,
      returnPolicyId: config.returnPolicyId,
      fulfillmentPolicyId: config.fulfillmentPolicyId,
      shipFromCountry,
    },
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
              Brand: [stringOrNull(payload.brand) ?? "Unbranded"],
              MPN: [stringOrNull(payload.mpn) ?? "Does Not Apply"],
              Type: ["Does Not Apply"],
              CountryOfOrigin: [shipFromCountry],
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
          },
          body: JSON.stringify({
            sku: inventoryItemKey,
            marketplaceId: config.marketplaceId,
            format: "FIXED_PRICE",
            availableQuantity: quantity,
            categoryId,
            merchantLocationKey,
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
