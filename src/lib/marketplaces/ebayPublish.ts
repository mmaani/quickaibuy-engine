import { getMediaStorageMode } from "@/lib/media/storage";
import { normalizeWarehouseCountry } from "@/lib/marketplaces/ebay/normalizeWarehouseCountry";
import { classifyHostedImage } from "@/lib/marketplaces/ebayImageHosting";
import { db } from "@/lib/db";
import { buildListingPreviewMedia } from "@/lib/listings/media";
import type { ListingPreviewInput } from "@/lib/listings/types";
import { sql } from "drizzle-orm";

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
  resolvedMerchantLocationSource: "configured-default" | null;
  shippingTransparency: {
    handlingDaysMin: number;
    handlingDaysMax: number;
    shippingDaysMin: number;
    shippingDaysMax: number;
    mode: "international";
    source: "cn-default" | "payload";
  } | null;
  config: EbayPublishConfig | null;
  publicUrls: {
    privacyPolicyUrl: string | null;
    authAcceptedUrl: string | null;
    authDeclinedUrl: string | null;
  };
  inventoryLocationFound: boolean;
  inventoryLocations: EbayInventoryLocationSummary[];
};

type PublishMediaHydrationRow = {
  candidateId: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  supplierTitle: string | null;
  supplierSourceUrl: string | null;
  supplierImages: unknown;
  supplierRawPayload: unknown;
  supplierPrice: string | number | null;
  supplierWarehouseCountry: string | null;
  marketplaceKey: string | null;
  marketplaceListingId: string | null;
  marketplaceTitle: string | null;
  marketplaceImageUrl: string | null;
  marketplaceRawPayload: unknown;
  marketplacePrice: string | number | null;
  estimatedProfit: string | number | null;
  marginPct: string | number | null;
  roiPct: string | number | null;
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => stringOrNull(entry)).filter((entry): entry is string => Boolean(entry));
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
      MEDIA_STORAGE_MODE: getMediaStorageMode(),
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
  const media = objectOrNull(raw.media) ?? {};

  const cleanedSource: Record<string, unknown> = {
    candidateId: stringOrNull(source.candidateId),
    supplierKey: stringOrNull(source.supplierKey),
    supplierProductId: stringOrNull(source.supplierProductId),
    supplierTitle: stringOrNull(source.supplierTitle),
    supplierSourceUrl: stringOrNull(source.supplierSourceUrl),
    supplierWarehouseCountry:
      stringOrNull(source.supplierWarehouseCountry) ?? stringOrNull(source.shipFromCountry),
    shipFromCountry: stringOrNull(source.shipFromCountry),
    supplierImageUrl: stringOrNull(source.supplierImageUrl),
    supplierImages: stringArray(source.supplierImages),
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
    media: sanitizeMedia(media),
    source: cleanedSource,
    matchedMarketplace: cleanedMatchedMarketplace,
    economics: cleanedEconomics,
  };

  return cleaned;
}

function sanitizeMedia(value: Record<string, unknown>): Record<string, unknown> | null {
  const images = Array.isArray(value.images)
    ? value.images
        .map((entry) => {
          if (typeof entry === "string") {
            return { url: stringOrNull(entry) };
          }

          const image = objectOrNull(entry);
          if (!image) return null;

          return {
            url: stringOrNull(image.url),
            kind: stringOrNull(image.kind),
            rank: numberOrNull(image.rank),
            source: stringOrNull(image.source),
            fingerprint: stringOrNull(image.fingerprint),
            hostingMode: stringOrNull(image.hostingMode),
            reasons: stringArray(image.reasons),
          };
        })
        .filter((entry) => Boolean(entry?.url))
    : [];

  const videoInput = objectOrNull(value.video);
  const video = videoInput
    ? {
        url: stringOrNull(videoInput.url),
        format: stringOrNull(videoInput.format),
        durationSeconds: numberOrNull(videoInput.durationSeconds),
        sizeBytes: numberOrNull(videoInput.sizeBytes),
        validationOk: Boolean(videoInput.validationOk),
        validationReason: stringOrNull(videoInput.validationReason),
        attachOnPublish: Boolean(videoInput.attachOnPublish),
        publishSupported: Boolean(videoInput.publishSupported),
        operatorNote: stringOrNull(videoInput.operatorNote),
      }
    : null;

  const auditInput = objectOrNull(value.audit);
  const audit = auditInput
    ? {
        imageCandidateCount: numberOrNull(auditInput.imageCandidateCount),
        imageSelectedCount: numberOrNull(auditInput.imageSelectedCount),
        imageSkippedCount: numberOrNull(auditInput.imageSkippedCount),
        imageHostingMode: stringOrNull(auditInput.imageHostingMode),
        mixedImageHostingModesDropped: Boolean(auditInput.mixedImageHostingModesDropped),
        selectedImageUrls: stringArray(auditInput.selectedImageUrls),
        selectedImageKinds: stringArray(auditInput.selectedImageKinds),
        selectedImageSlots: stringArray(auditInput.selectedImageSlots),
        imageNormalization:
          objectOrNull(auditInput.imageNormalization) ?? null,
        imageHostingValidation:
          objectOrNull(auditInput.imageHostingValidation) ?? null,
        videoDetected: Boolean(auditInput.videoDetected),
        videoAttached: Boolean(auditInput.videoAttached),
        videoSkipped: Boolean(auditInput.videoSkipped),
        videoSkipReason: stringOrNull(auditInput.videoSkipReason),
        operatorNote: stringOrNull(auditInput.operatorNote),
      }
    : null;

  if (!images.length && !video && !audit) return null;
  return {
    images,
    video,
    audit,
  };
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

function parsePositiveInt(value: unknown): number | null {
  const n = numberOrNull(value);
  if (n == null) return null;
  const rounded = Math.floor(n);
  return rounded > 0 ? rounded : null;
}

function resolveShippingTransparency(payload: Record<string, unknown>, shipFromCountry: string | null): {
  handlingDaysMin: number;
  handlingDaysMax: number;
  shippingDaysMin: number;
  shippingDaysMax: number;
  mode: "international";
  source: "cn-default" | "payload";
} | null {
  const handlingDaysMin = parsePositiveInt(
    payload.handlingDaysMin ?? payload.handling_time_min_days ?? payload.handlingTimeMinDays
  );
  const handlingDaysMax = parsePositiveInt(
    payload.handlingDaysMax ?? payload.handling_time_max_days ?? payload.handlingTimeMaxDays
  );
  const shippingDaysMin = parsePositiveInt(
    payload.shippingDaysMin ?? payload.shipping_time_min_days ?? payload.shippingTimeMinDays
  );
  const shippingDaysMax = parsePositiveInt(
    payload.shippingDaysMax ?? payload.shipping_time_max_days ?? payload.shippingTimeMaxDays
  );

  if (handlingDaysMin && handlingDaysMax && shippingDaysMin && shippingDaysMax) {
    return {
      handlingDaysMin,
      handlingDaysMax,
      shippingDaysMin,
      shippingDaysMax,
      mode: "international",
      source: "payload",
    };
  }

  if (normalizeLocationCountry(shipFromCountry) === "CN") {
    return {
      handlingDaysMin: 2,
      handlingDaysMax: 3,
      shippingDaysMin: 7,
      shippingDaysMax: 12,
      mode: "international",
      source: "cn-default",
    };
  }

  return null;
}

export function validateEbayPublishPayloadRequirements(payloadInput: unknown): {
  ok: boolean;
  shipFromCountry: string | null;
  shippingTransparency: {
    handlingDaysMin: number;
    handlingDaysMax: number;
    shippingDaysMin: number;
    shippingDaysMax: number;
    mode: "international";
    source: "cn-default" | "payload";
  } | null;
  errors: string[];
} {
  const payload = sanitizeEbayPayload(payloadInput);
  const shipFromCountry = resolveShipFromCountry(payload);
  const shippingTransparency = resolveShippingTransparency(payload, shipFromCountry);
  const errors: string[] = [];

  if (!shipFromCountry) {
    errors.push(
      "Missing normalized supplier ship-from country. Provide supplier_warehouse_country (preferred) or ship_from_country so eBay publish can set item origin explicitly."
    );
  }

  if (!shippingTransparency) {
    errors.push(
      "Missing shipping transparency for supplier fulfillment. Provide handling/shipping timing or keep supplier country clear enough for fail-closed defaults."
    );
  }

  return {
    ok: errors.length === 0,
    shipFromCountry,
    shippingTransparency,
    errors,
  };
}

function resolveMerchantLocationForShipFromCountry(input: {
  config: EbayPublishConfig;
  shipFromCountry: string | null;
  inventoryLocations: EbayInventoryLocationSummary[];
}): {
  merchantLocationKey: string | null;
  source: "configured-default" | null;
  error?: string;
  warning?: string;
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

  if (configuredLocation) {
    return {
      merchantLocationKey: configuredLocation.merchantLocationKey,
      source: "configured-default",
      warning:
        configuredCountry && configuredCountry !== normalizedShipFromCountry
          ? `Merchant inventory location ${configuredLocation.merchantLocationKey} resolves to ${configuredCountry}, while supplier ship-from country is ${normalizedShipFromCountry}. Using seller location with international-fulfillment transparency.`
          : undefined,
    };
  }

  return {
    merchantLocationKey: null,
    source: null,
    error: `Configured EBAY_MERCHANT_LOCATION_KEY '${input.config.merchantLocationKey}' was not found in seller inventory locations. Run scripts/check_ebay_inventory_location.ts and fix eBay account setup.`,
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

  const shippingTransparency = resolveShippingTransparency(payload, resolveShipFromCountry(payload));
  const shippingLine = shippingTransparency
    ? `- Handling time: ${shippingTransparency.handlingDaysMin}-${shippingTransparency.handlingDaysMax} business days\n- Estimated delivery: ${shippingTransparency.shippingDaysMin}-${shippingTransparency.shippingDaysMax} business days\n- International fulfillment from supplier warehouse`
    : "- Shipping timing is operator-reviewed before dispatch";

  const lines = [
    title,
    "",
    "Key features:",
    features.length > 0 ? `- ${features.join("\n- ")}` : "- Compact and practical design\n- Everyday-use convenience\n- Ready for immediate dispatch",
    "",
    "Shipping:",
    shippingLine,
    "",
    "Package includes:",
    "- 1 item",
    "",
    "Condition: New",
  ];

  return lines.join("\n").slice(0, 4000);
}

function buildListingAspects(payload: Record<string, unknown>, shipFromCountry: string): Record<string, string[]> {
  const fromPayload =
    payload.itemSpecifics && typeof payload.itemSpecifics === "object" && !Array.isArray(payload.itemSpecifics)
      ? (payload.itemSpecifics as Record<string, unknown>)
      : {};

  const aspects: Record<string, string[]> = {};
  for (const [key, rawValue] of Object.entries(fromPayload)) {
    const aspectKey = String(key ?? "").trim();
    const aspectValue = rawValue == null ? "" : String(rawValue).trim();
    if (!aspectKey || !aspectValue) continue;
    aspects[aspectKey] = [aspectValue];
  }

  if (!aspects.Brand?.length) aspects.Brand = [stringOrNull(payload.brand) ?? "Unbranded"];
  if (!aspects.MPN?.length) aspects.MPN = [stringOrNull(payload.mpn) ?? "Does Not Apply"];
  if (!aspects.Type?.length) aspects.Type = ["Does Not Apply"];
  if (!aspects.CountryOfOrigin?.length) aspects.CountryOfOrigin = [shipFromCountry];

  return aspects;
}

type EbayImageHostingMode = "external" | "self_hosted" | "eps" | "invalid";
type EbayImageHostingCode =
  | "IMAGE_HOSTING_OK"
  | "IMAGE_HOSTING_MIXED_BLOCKED"
  | "IMAGE_HOSTING_INVALID_URL"
  | "IMAGE_HOSTING_NONCANONICAL_SOURCE"
  | "IMAGE_HOSTING_EMPTY_BLOCKED";

type EbayImageHostingValidation = {
  ok: boolean;
  code: EbayImageHostingCode;
  canonicalMode: "eps";
  selectedUrls: string[];
  selectedCount: number;
  selectedMode: EbayImageHostingMode | null;
  byMode: Record<EbayImageHostingMode, string[]>;
  invalidUrls: string[];
  mixedModesDetected: boolean;
  reason: string;
};

function extractImageUrls(payload: Record<string, unknown>): {
  urls: string[];
  hostingMode: EbayImageHostingMode | null;
  mixedModesDropped: boolean;
  byMode: Record<EbayImageHostingMode, string[]>;
} {
  const images: string[] = [];
  const source = objectOrNull(payload.source) ?? {};
  const supplierImage = stringOrNull(source.supplierImageUrl);
  const supplierImages = stringArray(source.supplierImages);
  const media = objectOrNull(payload.media);
  const mediaImages = Array.isArray(media?.images) ? media?.images : [];

  for (const entry of mediaImages) {
    const image = objectOrNull(entry);
    const url = stringOrNull(image?.url);
    if (url) images.push(url);
  }

  const rawImages = Array.isArray(payload.images) ? payload.images : [];
  for (const entry of rawImages) {
    const url = stringOrNull(entry);
    if (url) images.push(url);
  }

  if (images.length === 0) {
    for (const url of supplierImages) {
      images.push(url);
    }
    if (images.length === 0 && supplierImage) {
      images.push(supplierImage);
    }
  }

  const deduped = [...new Set(images)];
  const byModeMap = new Map<EbayImageHostingMode, string[]>();

  for (const url of deduped) {
    const mode = classifyHostedImage(url);
    const current = byModeMap.get(mode) ?? [];
    current.push(url);
    byModeMap.set(mode, current);
  }

  const selectedMode =
    Array.from(byModeMap.entries()).sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? null;
  const mixedModesDropped = Array.from(byModeMap.keys()).filter((mode) => mode !== "invalid").length > 1;
  const byMode: Record<EbayImageHostingMode, string[]> = {
    eps: byModeMap.get("eps") ?? [],
    self_hosted: byModeMap.get("self_hosted") ?? [],
    external: byModeMap.get("external") ?? [],
    invalid: byModeMap.get("invalid") ?? [],
  };

  return {
    urls: selectedMode ? (byModeMap.get(selectedMode) ?? []).slice(0, 24) : [],
    hostingMode: selectedMode,
    mixedModesDropped,
    byMode,
  };
}

export function validateEbayImageHosting(payload: Record<string, unknown>): EbayImageHostingValidation {
  const imageSelection = extractImageUrls(payload);
  const invalidUrls = imageSelection.byMode.invalid;
  const nonInvalidModes = (["eps", "self_hosted", "external"] as const).filter(
    (mode) => imageSelection.byMode[mode].length > 0
  );

  if (imageSelection.urls.length === 0) {
    return {
      ok: false,
      code: "IMAGE_HOSTING_EMPTY_BLOCKED",
      canonicalMode: "eps",
      selectedUrls: [],
      selectedCount: 0,
      selectedMode: null,
      byMode: imageSelection.byMode,
      invalidUrls,
      mixedModesDetected: false,
      reason: "No outgoing listing images were available for eBay publish/revise.",
    };
  }

  if (invalidUrls.length > 0) {
    return {
      ok: false,
      code: "IMAGE_HOSTING_INVALID_URL",
      canonicalMode: "eps",
      selectedUrls: imageSelection.urls,
      selectedCount: imageSelection.urls.length,
      selectedMode: imageSelection.hostingMode,
      byMode: imageSelection.byMode,
      invalidUrls,
      mixedModesDetected: nonInvalidModes.length > 1,
      reason: "One or more outgoing listing image URLs are invalid or unclassifiable.",
    };
  }

  if (nonInvalidModes.length > 1) {
    return {
      ok: false,
      code: "IMAGE_HOSTING_MIXED_BLOCKED",
      canonicalMode: "eps",
      selectedUrls: imageSelection.urls,
      selectedCount: imageSelection.urls.length,
      selectedMode: imageSelection.hostingMode,
      byMode: imageSelection.byMode,
      invalidUrls,
      mixedModesDetected: true,
      reason: "Outgoing listing image URLs mix EPS-hosted and non-EPS hosting classes.",
    };
  }

  if (imageSelection.hostingMode !== "eps") {
    return {
      ok: false,
      code: "IMAGE_HOSTING_NONCANONICAL_SOURCE",
      canonicalMode: "eps",
      selectedUrls: imageSelection.urls,
      selectedCount: imageSelection.urls.length,
      selectedMode: imageSelection.hostingMode,
      byMode: imageSelection.byMode,
      invalidUrls,
      mixedModesDetected: false,
      reason: "Outgoing listing image URLs are not EPS-hosted. QuickAIBuy v1 requires EPS-only final eBay image payloads.",
    };
  }

  return {
    ok: true,
    code: "IMAGE_HOSTING_OK",
    canonicalMode: "eps",
    selectedUrls: imageSelection.urls,
    selectedCount: imageSelection.urls.length,
    selectedMode: imageSelection.hostingMode,
    byMode: imageSelection.byMode,
    invalidUrls,
    mixedModesDetected: false,
    reason: "Outgoing listing image URLs are EPS-only and valid for eBay publish/revise.",
  };
}

function payloadAlreadyHasNormalizedMedia(payload: Record<string, unknown>): boolean {
  const media = objectOrNull(payload.media);
  if (!media) return false;

  const images = Array.isArray(media.images) ? media.images : [];
  const hasImage = images.some((entry) => Boolean(stringOrNull(objectOrNull(entry)?.url)));
  const video = objectOrNull(media.video);
  const hasVideo = Boolean(stringOrNull(video?.url));
  const audit = objectOrNull(media.audit);

  return hasImage || hasVideo || Boolean(audit);
}

async function hydrateReferenceOnlyMediaPayload(
  listing: EbayListingPayload,
  payload: Record<string, unknown>
): Promise<{ payload: Record<string, unknown>; hydrated: boolean }> {
  if (payloadAlreadyHasNormalizedMedia(payload)) {
    return { payload, hydrated: false };
  }

  const rowResult = await db.execute<PublishMediaHydrationRow>(sql`
    SELECT
      pc.id::text AS "candidateId",
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      pr.title AS "supplierTitle",
      pr.source_url AS "supplierSourceUrl",
      pr.images AS "supplierImages",
      pr.raw_payload AS "supplierRawPayload",
      pr.price_min AS "supplierPrice",
      ${sql.raw("NULL")}::text AS "supplierWarehouseCountry",
      pc.marketplace_key AS "marketplaceKey",
      pc.marketplace_listing_id AS "marketplaceListingId",
      mp.matched_title AS "marketplaceTitle",
      mp.image_url AS "marketplaceImageUrl",
      mp.raw_payload AS "marketplaceRawPayload",
      mp.price AS "marketplacePrice",
      pc.estimated_profit AS "estimatedProfit",
      pc.margin_pct AS "marginPct",
      pc.roi_pct AS "roiPct"
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    LEFT JOIN products_raw pr
      ON pr.id = pc.supplier_snapshot_id
    LEFT JOIN marketplace_prices mp
      ON mp.id = pc.market_price_snapshot_id
    WHERE l.id = ${listing.id}
    LIMIT 1
  `);

  const row = rowResult.rows[0];
  if (!row?.candidateId || !row.supplierKey || !row.supplierProductId || !row.marketplaceKey || !row.marketplaceListingId) {
    return { payload, hydrated: false };
  }

  const source = objectOrNull(payload.source) ?? {};
  const supplierImages = stringArray(row.supplierImages);
  const media = buildListingPreviewMedia({
    candidateId: row.candidateId,
    supplierKey: row.supplierKey,
    supplierProductId: row.supplierProductId,
    supplierTitle: stringOrNull(row.supplierTitle) ?? stringOrNull(source.supplierTitle),
    supplierSourceUrl: stringOrNull(row.supplierSourceUrl) ?? stringOrNull(source.supplierSourceUrl),
    supplierImageUrl:
      stringOrNull(source.supplierImageUrl) ??
      supplierImages[0] ??
      null,
    supplierImages,
    supplierPrice: numberOrNull(row.supplierPrice),
    supplierRawPayload: row.supplierRawPayload,
    supplierWarehouseCountry:
      stringOrNull(source.supplierWarehouseCountry) ??
      stringOrNull(source.shipFromCountry) ??
      stringOrNull(row.supplierWarehouseCountry),
    shipFromCountry: stringOrNull(payload.shipFromCountry) ?? stringOrNull(source.shipFromCountry),
    marketplaceImageUrl: stringOrNull(row.marketplaceImageUrl),
    marketplaceKey: row.marketplaceKey,
    marketplaceListingId: row.marketplaceListingId,
    marketplaceTitle: stringOrNull(row.marketplaceTitle),
    marketplaceRawPayload: row.marketplaceRawPayload,
    marketplacePrice: numberOrNull(row.marketplacePrice),
    estimatedProfit: numberOrNull(row.estimatedProfit),
    marginPct: numberOrNull(row.marginPct),
    roiPct: numberOrNull(row.roiPct),
    categoryId: stringOrNull(payload.categoryId),
  } satisfies ListingPreviewInput);

  return {
    hydrated: true,
    payload: {
      ...payload,
      images: media.images.map((image) => image.url),
      media,
      source: {
        ...source,
        supplierImages:
          stringArray(source.supplierImages).length > 0 ? stringArray(source.supplierImages) : supplierImages,
        supplierImageUrl:
          stringOrNull(source.supplierImageUrl) ??
          media.images[0]?.url ??
          supplierImages[0] ??
          null,
      },
    },
  };
}

function extractVideoDecision(payload: Record<string, unknown>): {
  detected: boolean;
  attached: boolean;
  skipped: boolean;
  skipReason: string | null;
  operatorNote: string | null;
  url: string | null;
} {
  const media = objectOrNull(payload.media);
  const video = objectOrNull(media?.video);
  if (!video) {
    return {
      detected: false,
      attached: false,
      skipped: true,
      skipReason: "no supplier video detected",
      operatorNote: null,
      url: null,
    };
  }

  const validationOk = Boolean(video.validationOk);
  const publishSupported = Boolean(video.publishSupported);
  const attachOnPublish = Boolean(video.attachOnPublish && validationOk && publishSupported);
  const operatorNote = stringOrNull(video.operatorNote);
  const validationReason = stringOrNull(video.validationReason);

  return {
    detected: true,
    attached: attachOnPublish,
    skipped: !attachOnPublish,
    skipReason: attachOnPublish
      ? null
      : validationReason ?? (publishSupported ? "video not attached" : "publish path not verified safe for video"),
    operatorNote,
    url: stringOrNull(video.url),
  };
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
  const payloadRequirements = validateEbayPublishPayloadRequirements(payload);
  const shipFromCountry = payloadRequirements.shipFromCountry;
  const shippingTransparency = payloadRequirements.shippingTransparency;

  const envValidation = buildEbayPublishConfigValidation();
  const errors = [...envValidation.errors, ...payloadRequirements.errors];
  const warnings: string[] = [];
  let resolvedMerchantLocationKey: string | null = null;
  let resolvedMerchantLocationSource: "configured-default" | null = null;

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
        } else if (merchantLocation.warning) {
          warnings.push(merchantLocation.warning);
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
    shippingTransparency,
    config: envValidation.config,
    publicUrls: envValidation.publicUrls,
    inventoryLocationFound,
    inventoryLocations,
  };
}

export async function publishToEbayListing(listing: EbayListingPayload): Promise<EbayPublishResult> {
  const mediaStorageMode = getMediaStorageMode();
  if (mediaStorageMode !== "reference_only") {
    return {
      success: false,
      externalListingId: null,
      raw: {
        mediaStorageMode,
      },
      errorMessage: `unsupported MEDIA_STORAGE_MODE for eBay publish: ${mediaStorageMode}`,
    };
  }

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

  let payload = sanitizeEbayPayload(listing.payload);
  let mediaHydratedFromCandidate = false;

  try {
    const hydrated = await hydrateReferenceOnlyMediaPayload(listing, payload);
    payload = hydrated.payload;
    mediaHydratedFromCandidate = hydrated.hydrated;
  } catch (err) {
    console.warn("publishToEbayListing: media hydration fallback failed", {
      listingId: listing.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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
  const shippingTransparency = preflight.shippingTransparency;

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
  const imageHostingValidation = validateEbayImageHosting(payload);
  const videoDecision = extractVideoDecision(payload);
  const description = buildDescription(payload, title);
  const categoryId = resolveCategoryId(payload, config);

  if (!imageHostingValidation.ok) {
    return {
      success: false,
      externalListingId: null,
      raw: { payload, imageHostingValidation },
      errorMessage: `${imageHostingValidation.code}: ${imageHostingValidation.reason}`,
    };
  }

  const raw: Record<string, unknown> = {
    inventoryItemKey,
    shipFromCountry,
    shippingTransparency,
    sanitizedPayload: payload,
    publishInput: {
      marketplaceId: config.marketplaceId,
      merchantLocationKey,
      merchantLocationSource: preflight.resolvedMerchantLocationSource,
      categoryId,
      paymentPolicyId: config.paymentPolicyId,
      returnPolicyId: config.returnPolicyId,
      fulfillmentPolicyId: config.fulfillmentPolicyId,
      shipFromCountry,
    },
    mediaAudit: {
      storageMode: mediaStorageMode,
      mediaHydratedFromCandidate,
      imageCountSelected: imageHostingValidation.selectedCount,
      imageHostingMode: imageHostingValidation.selectedMode,
      mixedImageHostingModesDropped: imageHostingValidation.mixedModesDetected,
      imageHostingValidation,
      videoDetected: videoDecision.detected,
      videoAttached: videoDecision.attached,
      videoSkipped: videoDecision.skipped,
      videoSkipReason: videoDecision.skipReason,
      operatorNote: videoDecision.operatorNote,
      videoUrl: videoDecision.url,
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
            imageUrls: imageHostingValidation.selectedUrls,
            aspects: buildListingAspects(payload, shipFromCountry),
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
