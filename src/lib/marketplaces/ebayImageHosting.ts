import crypto from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ebayImageNormalizations } from "@/lib/db/schema";

export type EbayHostedImageMode = "external" | "self_hosted" | "eps" | "invalid";
export type EbayImageNormalizationCode =
  | "IMAGE_NORMALIZATION_PENDING"
  | "IMAGE_NORMALIZATION_OK"
  | "IMAGE_NORMALIZATION_FAILED"
  | "IMAGE_NORMALIZATION_CACHE_HIT"
  | "IMAGE_NORMALIZATION_INVALID_SOURCE"
  | "IMAGE_NORMALIZATION_UPLOAD_FAILED"
  | "IMAGE_NORMALIZATION_TOO_SMALL"
  | "IMAGE_NORMALIZATION_EMPTY_BLOCKED"
  | "IMAGE_PROVIDER_MEDIA_API_OK"
  | "IMAGE_PROVIDER_MEDIA_API_FAILED"
  | "IMAGE_PROVIDER_TRADING_FALLBACK_OK"
  | "IMAGE_PROVIDER_TRADING_FALLBACK_FAILED"
  | "IMAGE_PROVIDER_CONFIGURATION_INVALID"
  | "IMAGE_NORMALIZATION_PROVIDER_EXHAUSTED";

export type EbayImageHostingProviderName =
  | "media_api_url"
  | "media_api_file"
  | "trading_upload_site_hosted_pictures"
  | "mock_eps";

export type EbayImageProviderDefault = "media_api" | "trading" | "mock_eps";

export type EbayImageNormalizationCacheRecord = {
  sourceUrl: string;
  sourceHash: string;
  epsUrl: string | null;
  provider: EbayImageHostingProviderName;
  status: "OK" | "FAILED";
  failureCode: EbayImageNormalizationCode | null;
  failureReason: string | null;
};

export type EbayImageHostingProvider = {
  name: EbayImageHostingProviderName;
  normalizeImageFromUrl(input: { sourceUrl: string }): Promise<{
    epsUrl: string;
    provider: EbayImageHostingProviderName;
    raw?: unknown;
  }>;
};

export type NormalizeHostedImageAttempt = {
  provider: EbayImageHostingProviderName;
  code: EbayImageNormalizationCode;
  ok: boolean;
  reason: string | null;
  raw?: unknown;
};

export type NormalizeHostedImageResult = {
  ok: boolean;
  code: EbayImageNormalizationCode;
  sourceUrl: string;
  sourceHash: string | null;
  epsUrl: string | null;
  provider: EbayImageHostingProviderName | null;
  cacheHit: boolean;
  attemptedProviders: EbayImageHostingProviderName[];
  attempts: NormalizeHostedImageAttempt[];
  providerAttempted: EbayImageHostingProviderName | null;
  providerUsed: EbayImageHostingProviderName | null;
  mediaApiAttempted: boolean;
  mediaApiResultCode: EbayImageNormalizationCode | null;
  tradingFallbackAttempted: boolean;
  tradingFallbackResultCode: EbayImageNormalizationCode | null;
  raw?: unknown;
  reason: string | null;
};

type ImageHostingConfig = {
  defaultProvider: EbayImageProviderDefault;
  allowTradingFallback: boolean;
};

type MockProviderBehavior = {
  mediaApiShouldFail?: boolean;
  tradingShouldFail?: boolean;
};

const EBAY_SELL_INVENTORY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory";
const DEFAULT_COMPATIBILITY_LEVEL = "1231";
const DEFAULT_SITE_ID = "0";
const DEFAULT_API_ROOT = "https://apim.ebay.com";
const DEFAULT_IDENTITY_ROOT = "https://api.ebay.com";

let cachedImageHostingToken: { token: string; expiresAt: number } | null = null;

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWebsiteHost(): string | null {
  const raw = stringOrNull(process.env.WEBSITE_URL);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getApiRoot(): string {
  return stringOrNull(process.env.EBAY_API_ROOT) ?? DEFAULT_API_ROOT;
}

export function canonicalizeEbayImageSourceUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function hashEbayImageSource(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

export function classifyHostedImage(url: string): EbayHostedImageMode {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "invalid";
    const host = parsed.hostname.toLowerCase();
    const siteHost = normalizeWebsiteHost();
    if (host.endsWith("ebayimg.com")) return "eps";
    if (siteHost && host === siteHost) return "self_hosted";
    return "external";
  } catch {
    return "invalid";
  }
}

function parseLikelyLongestSide(url: string): number | null {
  const matches = Array.from(url.matchAll(/(?:^|[_=/-])(\d{2,4})[xX](\d{2,4})(?:$|[_.?&/-])/g));
  const last = matches[matches.length - 1];
  if (!last) return null;
  const width = Number(last[1]);
  const height = Number(last[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return Math.max(width, height);
}

export function getEbayImageHostingConfig(): ImageHostingConfig {
  const rawDefault = stringOrNull(process.env.EBAY_IMAGE_PROVIDER_DEFAULT)?.toLowerCase();
  const rawLegacy = stringOrNull(process.env.EBAY_IMAGE_HOSTING_PROVIDER)?.toLowerCase();

  let defaultProvider: EbayImageProviderDefault = "media_api";
  if (rawDefault === "media_api" || rawDefault === "trading" || rawDefault === "mock_eps") {
    defaultProvider = rawDefault;
  } else if (rawDefault) {
    defaultProvider = "media_api";
  } else if (rawLegacy === "mock_eps") {
    defaultProvider = "mock_eps";
  } else if (rawLegacy === "upload_site_hosted_pictures") {
    defaultProvider = "trading";
  }

  const allowTradingFallback =
    String(process.env.EBAY_IMAGE_PROVIDER_ALLOW_TRADING_FALLBACK ?? "true").toLowerCase() === "true";

  return {
    defaultProvider,
    allowTradingFallback,
  };
}

async function readApiBody(res: Response): Promise<string> {
  return await res.text();
}

async function getImageHostingAccessToken(): Promise<string> {
  const clientId = stringOrNull(process.env.EBAY_CLIENT_ID);
  const clientSecret = stringOrNull(process.env.EBAY_CLIENT_SECRET);
  const refreshToken =
    stringOrNull(process.env.EBAY_REFRESH_TOKEN) ||
    stringOrNull(process.env.EBAY_USER_REFRESH_TOKEN);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing eBay OAuth credentials required for EPS image normalization.");
  }

  const now = Date.now();
  if (cachedImageHostingToken && cachedImageHostingToken.expiresAt > now + 60_000) {
    return cachedImageHostingToken.token;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${DEFAULT_IDENTITY_ROOT}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: EBAY_SELL_INVENTORY_SCOPE,
    }),
    cache: "no-store",
  });

  const body = await readApiBody(res);
  if (!res.ok) {
    throw new Error(`eBay image-hosting token refresh failed: ${res.status} ${body.slice(0, 300)}`);
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error("eBay image-hosting token refresh returned malformed JSON.");
  }

  const accessToken = stringOrNull(parsed.access_token);
  const expiresIn = Number(parsed.expires_in ?? NaN);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("eBay image-hosting token refresh returned invalid access_token or expires_in.");
  }

  cachedImageHostingToken = {
    token: accessToken,
    expiresAt: now + expiresIn * 1000,
  };
  return accessToken;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function inferMediaApiImageUrl(body: unknown): string | null {
  const parsed = objectOrNull(body) ?? {};
  const image = objectOrNull(parsed.image);
  return (
    stringOrNull(parsed.imageUrl) ??
    stringOrNull(image?.imageUrl) ??
    stringOrNull(image?.url) ??
    stringOrNull(parsed.image_url)
  );
}

function createMockProvider(name: EbayImageHostingProviderName, behavior?: MockProviderBehavior): EbayImageHostingProvider {
  const shouldFail =
    (name === "media_api_url" && behavior?.mediaApiShouldFail) ||
    (name === "trading_upload_site_hosted_pictures" && behavior?.tradingShouldFail);
  return {
    name,
    async normalizeImageFromUrl(input) {
      const canonical = canonicalizeEbayImageSourceUrl(input.sourceUrl);
      if (!canonical) {
        throw new Error("IMAGE_NORMALIZATION_INVALID_SOURCE: source image URL must be HTTPS.");
      }
      if (shouldFail) {
        throw new Error(`${name} mock failure`);
      }
      const hash = hashEbayImageSource(`${name}:${canonical}`).slice(0, 12);
      return {
        epsUrl: `https://i.ebayimg.com/images/g/${hash}/s-l1600.jpg`,
        provider: name,
        raw: { mock: true, provider: name, sourceUrl: canonical },
      };
    },
  };
}

function createMediaApiUrlProvider(): EbayImageHostingProvider {
  return {
    name: "media_api_url",
    async normalizeImageFromUrl(input) {
      const canonical = canonicalizeEbayImageSourceUrl(input.sourceUrl);
      if (!canonical) {
        throw new Error("IMAGE_NORMALIZATION_INVALID_SOURCE: source image URL must be HTTPS.");
      }

      const token = await getImageHostingAccessToken();
      const res = await fetch(`${getApiRoot()}/commerce/media/v1_beta/image/create_image_from_url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
        body: JSON.stringify({ url: canonical }),
        cache: "no-store",
      });

      const bodyText = await readApiBody(res);
      let parsed: unknown = bodyText;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        // keep raw text for diagnostics
      }

      if (!res.ok) {
        throw new Error(`Media API createImageFromUrl failed: ${res.status} ${bodyText.slice(0, 300)}`);
      }

      const epsUrl = inferMediaApiImageUrl(parsed);
      if (!epsUrl || classifyHostedImage(epsUrl) !== "eps") {
        throw new Error("Media API did not return a usable EPS-hosted image URL.");
      }

      return {
        epsUrl,
        provider: "media_api_url",
        raw: parsed,
      };
    },
  };
}

function createUploadSiteHostedPicturesProvider(): EbayImageHostingProvider {
  return {
    name: "trading_upload_site_hosted_pictures",
    async normalizeImageFromUrl(input) {
      const canonical = canonicalizeEbayImageSourceUrl(input.sourceUrl);
      if (!canonical) {
        throw new Error("IMAGE_NORMALIZATION_INVALID_SOURCE: source image URL must be HTTPS.");
      }

      const token = await getImageHostingAccessToken();
      const body = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ExternalPictureURL>${xmlEscape(canonical)}</ExternalPictureURL>
  <PictureSet>Supersize</PictureSet>
</UploadSiteHostedPicturesRequest>`;

      const res = await fetch(`${getApiRoot()}/ws/api.dll`, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
          "X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
          "X-EBAY-API-COMPATIBILITY-LEVEL":
            stringOrNull(process.env.EBAY_TRADING_COMPATIBILITY_LEVEL) ?? DEFAULT_COMPATIBILITY_LEVEL,
          "X-EBAY-API-SITEID": stringOrNull(process.env.EBAY_TRADING_SITE_ID) ?? DEFAULT_SITE_ID,
          "X-EBAY-API-IAF-TOKEN": token,
        },
        body,
        cache: "no-store",
      });

      const text = await readApiBody(res);
      if (!res.ok) {
        throw new Error(`UploadSiteHostedPictures failed: ${res.status} ${text.slice(0, 300)}`);
      }

      const ack = text.match(/<Ack>([^<]+)<\/Ack>/i)?.[1]?.trim().toUpperCase() ?? null;
      const fullUrl = text.match(/<FullURL>([^<]+)<\/FullURL>/i)?.[1]?.trim() ?? null;

      if (!ack || (ack !== "SUCCESS" && ack !== "WARNING")) {
        throw new Error(`UploadSiteHostedPictures returned non-success ack: ${ack ?? "UNKNOWN"}`);
      }
      if (!fullUrl || classifyHostedImage(fullUrl) !== "eps") {
        throw new Error("UploadSiteHostedPictures did not return a usable EPS-hosted image URL.");
      }

      return {
        epsUrl: fullUrl,
        provider: "trading_upload_site_hosted_pictures",
        raw: {
          ack,
          fullUrl,
        },
      };
    },
  };
}

function resolveProviderPriority(
  override: EbayImageHostingProvider | null | undefined,
  behavior?: MockProviderBehavior
): EbayImageHostingProvider[] {
  if (override) return [override];

  const config = getEbayImageHostingConfig();
  if (config.defaultProvider === "mock_eps") {
    return [createMockProvider("mock_eps", behavior)];
  }

  const media = behavior ? createMockProvider("media_api_url", behavior) : createMediaApiUrlProvider();
  const trading = behavior
    ? createMockProvider("trading_upload_site_hosted_pictures", behavior)
    : createUploadSiteHostedPicturesProvider();

  if (config.defaultProvider === "trading") {
    return [trading];
  }

  return config.allowTradingFallback ? [media, trading] : [media];
}

function inferAttemptCode(provider: EbayImageHostingProviderName, ok: boolean): EbayImageNormalizationCode {
  if (provider === "media_api_url" || provider === "media_api_file") {
    return ok ? "IMAGE_PROVIDER_MEDIA_API_OK" : "IMAGE_PROVIDER_MEDIA_API_FAILED";
  }
  if (provider === "trading_upload_site_hosted_pictures") {
    return ok ? "IMAGE_PROVIDER_TRADING_FALLBACK_OK" : "IMAGE_PROVIDER_TRADING_FALLBACK_FAILED";
  }
  return ok ? "IMAGE_NORMALIZATION_OK" : "IMAGE_NORMALIZATION_UPLOAD_FAILED";
}

function choosePreferredCache(
  rows: EbayImageNormalizationCacheRecord[]
): EbayImageNormalizationCacheRecord | null {
  const valid = rows.filter((row) => row.status === "OK" && row.epsUrl && classifyHostedImage(row.epsUrl) === "eps");
  if (valid.length === 0) return null;
  const media = valid.find((row) => row.provider === "media_api_url" || row.provider === "media_api_file");
  return media ?? valid[0] ?? null;
}

export async function findCachedNormalizedImage(
  sourceUrl: string,
  provider?: EbayImageHostingProviderName
): Promise<EbayImageNormalizationCacheRecord | null> {
  const canonical = canonicalizeEbayImageSourceUrl(sourceUrl);
  if (!canonical) return null;
  const rows = await db
    .select({
      sourceUrl: ebayImageNormalizations.sourceUrl,
      sourceHash: ebayImageNormalizations.sourceHash,
      epsUrl: ebayImageNormalizations.epsUrl,
      provider: ebayImageNormalizations.provider,
      status: ebayImageNormalizations.status,
      failureCode: ebayImageNormalizations.failureCode,
      failureReason: ebayImageNormalizations.failureReason,
    })
    .from(ebayImageNormalizations)
    .where(
      provider
        ? and(
            eq(ebayImageNormalizations.sourceUrl, canonical),
            eq(ebayImageNormalizations.provider, provider)
          )
        : and(
            eq(ebayImageNormalizations.sourceUrl, canonical),
            inArray(ebayImageNormalizations.provider, [
              "media_api_url",
              "media_api_file",
              "trading_upload_site_hosted_pictures",
              "mock_eps",
            ])
          )
    )
    .orderBy(desc(ebayImageNormalizations.updatedAt));

  const row = provider
    ? rows[0]
    : choosePreferredCache(
        rows.map((entry) => ({
          sourceUrl: entry.sourceUrl,
          sourceHash: entry.sourceHash ?? hashEbayImageSource(canonical),
          epsUrl: entry.epsUrl ?? null,
          provider: entry.provider as EbayImageHostingProviderName,
          status: entry.status === "OK" ? "OK" : "FAILED",
          failureCode: (entry.failureCode as EbayImageNormalizationCode | null) ?? null,
          failureReason: entry.failureReason ?? null,
        }))
      );

  if (!row) return null;
  return {
    sourceUrl: row.sourceUrl,
    sourceHash: row.sourceHash ?? hashEbayImageSource(canonical),
    epsUrl: row.epsUrl ?? null,
    provider: (row.provider as EbayImageHostingProviderName) ?? "media_api_url",
    status: row.status === "OK" ? "OK" : "FAILED",
    failureCode: (row.failureCode as EbayImageNormalizationCode | null) ?? null,
    failureReason: row.failureReason ?? null,
  };
}

async function upsertNormalizationCache(record: EbayImageNormalizationCacheRecord): Promise<void> {
  await db
    .insert(ebayImageNormalizations)
    .values({
      sourceUrl: record.sourceUrl,
      sourceHash: record.sourceHash,
      epsUrl: record.epsUrl,
      provider: record.provider,
      status: record.status,
      failureCode: record.failureCode,
      failureReason: record.failureReason,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [ebayImageNormalizations.sourceUrl, ebayImageNormalizations.provider],
      set: {
        sourceHash: record.sourceHash,
        epsUrl: record.epsUrl,
        status: record.status,
        failureCode: record.failureCode,
        failureReason: record.failureReason,
        updatedAt: new Date(),
      },
    });
}

function buildFailureResult(input: {
  code: EbayImageNormalizationCode;
  sourceUrl: string;
  sourceHash: string | null;
  reason: string;
  attempts?: NormalizeHostedImageAttempt[];
  attemptedProviders?: EbayImageHostingProviderName[];
  providerAttempted?: EbayImageHostingProviderName | null;
  providerUsed?: EbayImageHostingProviderName | null;
  mediaApiAttempted?: boolean;
  mediaApiResultCode?: EbayImageNormalizationCode | null;
  tradingFallbackAttempted?: boolean;
  tradingFallbackResultCode?: EbayImageNormalizationCode | null;
}): NormalizeHostedImageResult {
  return {
    ok: false,
    code: input.code,
    sourceUrl: input.sourceUrl,
    sourceHash: input.sourceHash,
    epsUrl: null,
    provider: input.providerUsed ?? null,
    cacheHit: false,
    attempts: input.attempts ?? [],
    attemptedProviders: input.attemptedProviders ?? [],
    providerAttempted: input.providerAttempted ?? null,
    providerUsed: input.providerUsed ?? null,
    mediaApiAttempted: input.mediaApiAttempted ?? false,
    mediaApiResultCode: input.mediaApiResultCode ?? null,
    tradingFallbackAttempted: input.tradingFallbackAttempted ?? false,
    tradingFallbackResultCode: input.tradingFallbackResultCode ?? null,
    reason: input.reason,
  };
}

export async function normalizeImageFromUrl(
  sourceUrl: string,
  providerOverride?: EbayImageHostingProvider,
  mockBehavior?: MockProviderBehavior
): Promise<NormalizeHostedImageResult> {
  const config = getEbayImageHostingConfig();
  const canonical = canonicalizeEbayImageSourceUrl(sourceUrl);
  const sourceHash = canonical ? hashEbayImageSource(canonical) : null;

  if (!canonical) {
    return buildFailureResult({
      code: "IMAGE_NORMALIZATION_INVALID_SOURCE",
      sourceUrl,
      sourceHash,
      reason: "Image normalization requires a valid HTTPS source URL.",
    });
  }

  const likelyLongestSide = parseLikelyLongestSide(canonical);
  if (likelyLongestSide != null && likelyLongestSide < 500) {
    return buildFailureResult({
      code: "IMAGE_NORMALIZATION_TOO_SMALL",
      sourceUrl: canonical,
      sourceHash,
      reason: "Image appears below eBay minimum longest-side requirement of 500px.",
    });
  }

  if (config.defaultProvider !== "media_api" && config.defaultProvider !== "trading" && config.defaultProvider !== "mock_eps") {
    return buildFailureResult({
      code: "IMAGE_PROVIDER_CONFIGURATION_INVALID",
      sourceUrl: canonical,
      sourceHash,
      reason: "Invalid eBay image provider configuration.",
    });
  }

  if (classifyHostedImage(canonical) === "eps") {
    const provider = providerOverride?.name ?? "media_api_url";
    await upsertNormalizationCache({
      sourceUrl: canonical,
      sourceHash: sourceHash ?? hashEbayImageSource(canonical),
      epsUrl: canonical,
      provider,
      status: "OK",
      failureCode: null,
      failureReason: null,
    });
    return {
      ok: true,
      code: "IMAGE_NORMALIZATION_CACHE_HIT",
      sourceUrl: canonical,
      sourceHash,
      epsUrl: canonical,
      provider,
      cacheHit: true,
      attempts: [],
      attemptedProviders: [],
      providerAttempted: null,
      providerUsed: provider,
      mediaApiAttempted: false,
      mediaApiResultCode: null,
      tradingFallbackAttempted: false,
      tradingFallbackResultCode: null,
      reason: "Source image was already EPS-hosted.",
    };
  }

  const cached = await findCachedNormalizedImage(canonical);
  if (cached?.status === "OK" && cached.epsUrl && classifyHostedImage(cached.epsUrl) === "eps") {
    return {
      ok: true,
      code: "IMAGE_NORMALIZATION_CACHE_HIT",
      sourceUrl: canonical,
      sourceHash: cached.sourceHash,
      epsUrl: cached.epsUrl,
      provider: cached.provider,
      cacheHit: true,
      attempts: [],
      attemptedProviders: [],
      providerAttempted: null,
      providerUsed: cached.provider,
      mediaApiAttempted:
        cached.provider === "media_api_url" || cached.provider === "media_api_file",
      mediaApiResultCode:
        cached.provider === "media_api_url" || cached.provider === "media_api_file"
          ? "IMAGE_PROVIDER_MEDIA_API_OK"
          : null,
      tradingFallbackAttempted: cached.provider === "trading_upload_site_hosted_pictures",
      tradingFallbackResultCode:
        cached.provider === "trading_upload_site_hosted_pictures"
          ? "IMAGE_PROVIDER_TRADING_FALLBACK_OK"
          : null,
      reason: "Reused cached EPS-normalized image URL.",
    };
  }

  const providers = resolveProviderPriority(providerOverride, mockBehavior);
  const attempts: NormalizeHostedImageAttempt[] = [];
  const attemptedProviders: EbayImageHostingProviderName[] = [];
  let mediaApiAttempted = false;
  let mediaApiResultCode: EbayImageNormalizationCode | null = null;
  let tradingFallbackAttempted = false;
  let tradingFallbackResultCode: EbayImageNormalizationCode | null = null;

  for (const provider of providers) {
    attemptedProviders.push(provider.name);
    if (provider.name === "media_api_url" || provider.name === "media_api_file") {
      mediaApiAttempted = true;
    }
    if (provider.name === "trading_upload_site_hosted_pictures") {
      tradingFallbackAttempted = true;
    }

    try {
      const uploaded = await provider.normalizeImageFromUrl({ sourceUrl: canonical });
      const code = inferAttemptCode(provider.name, true);
      attempts.push({
        provider: provider.name,
        code,
        ok: true,
        reason: null,
        raw: uploaded.raw,
      });

      if (provider.name === "media_api_url" || provider.name === "media_api_file") {
        mediaApiResultCode = code;
      }
      if (provider.name === "trading_upload_site_hosted_pictures") {
        tradingFallbackResultCode = code;
      }

      await upsertNormalizationCache({
        sourceUrl: canonical,
        sourceHash: sourceHash ?? hashEbayImageSource(canonical),
        epsUrl: uploaded.epsUrl,
        provider: uploaded.provider,
        status: "OK",
        failureCode: null,
        failureReason: null,
      });

      return {
        ok: true,
        code: provider.name === "trading_upload_site_hosted_pictures"
          ? "IMAGE_PROVIDER_TRADING_FALLBACK_OK"
          : "IMAGE_PROVIDER_MEDIA_API_OK",
        sourceUrl: canonical,
        sourceHash,
        epsUrl: uploaded.epsUrl,
        provider: uploaded.provider,
        cacheHit: false,
        attempts,
        attemptedProviders,
        providerAttempted: provider.name,
        providerUsed: uploaded.provider,
        mediaApiAttempted,
        mediaApiResultCode,
        tradingFallbackAttempted,
        tradingFallbackResultCode,
        raw: uploaded.raw,
        reason:
          provider.name === "trading_upload_site_hosted_pictures"
            ? "Trading fallback normalized the image after Media API was unavailable."
            : "Media API normalized the image into an EPS-hosted URL.",
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const code = inferAttemptCode(provider.name, false);
      attempts.push({
        provider: provider.name,
        code,
        ok: false,
        reason,
      });

      if (provider.name === "media_api_url" || provider.name === "media_api_file") {
        mediaApiResultCode = code;
      }
      if (provider.name === "trading_upload_site_hosted_pictures") {
        tradingFallbackResultCode = code;
      }

      await upsertNormalizationCache({
        sourceUrl: canonical,
        sourceHash: sourceHash ?? hashEbayImageSource(canonical),
        epsUrl: null,
        provider: provider.name,
        status: "FAILED",
        failureCode: code,
        failureReason: reason,
      });
    }
  }

  const reason =
    attempts.map((attempt) => `${attempt.provider}: ${attempt.reason ?? attempt.code}`).join(" | ") ||
    "Image normalization provider chain exhausted.";

  return buildFailureResult({
    code: "IMAGE_NORMALIZATION_PROVIDER_EXHAUSTED",
    sourceUrl: canonical,
    sourceHash,
    reason,
    attempts,
    attemptedProviders,
    providerAttempted: attemptedProviders[attemptedProviders.length - 1] ?? null,
    providerUsed: null,
    mediaApiAttempted,
    mediaApiResultCode,
    tradingFallbackAttempted,
    tradingFallbackResultCode,
  });
}

export function createMockEbayImageHostingProvider(
  name: EbayImageHostingProviderName = "mock_eps",
  behavior?: MockProviderBehavior
): EbayImageHostingProvider {
  return createMockProvider(name, behavior);
}

export function createMockProviderBehavior(input?: MockProviderBehavior): MockProviderBehavior {
  return {
    mediaApiShouldFail: Boolean(input?.mediaApiShouldFail),
    tradingShouldFail: Boolean(input?.tradingShouldFail),
  };
}
