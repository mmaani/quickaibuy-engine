import type { SupplierProduct } from "./types";
import { inferAvailabilityFromText } from "@/lib/products/supplierAvailability";
import {
  compactText,
  extractPriceEvidence,
  extractShippingEvidence,
  inferListingValidity,
  sliceEvidence,
} from "./parserSignals";

const MAX_RESULTS = 20;

function looksLikeAliExpressChallengePage(text: string): boolean {
  const compact = compactText(text).toLowerCase();
  if (!compact) return false;
  return (
    compact.includes("_____tmd_____/punish") ||
    compact.includes("captcha") ||
    compact.includes("security verification") ||
    compact.includes("punish-page")
  );
}

function extractAliExpressChallengeHint(text: string): string | null {
  const compact = compactText(text).toLowerCase();
  if (!compact) return null;
  const match = compact.match(/(security verification|captcha|unusual traffic|punish-page)/i);
  return match?.[0] ? sliceEvidence(match[0]) : null;
}

function extractAvailabilityEvidence(rawText: string): {
  evidenceText: string | null;
  inventoryBadge: string | null;
  stockCount: number | null;
} {
  const compact = compactText(rawText);
  if (!compact) {
    return { evidenceText: null, inventoryBadge: null, stockCount: null };
  }

  const stockMatch = compact.match(
    /(?:only|just)\s+(\d{1,5})\s+(?:left|pieces?|items?)|(?:stock|inventory|available quantity)\s*[:=]?\s*(\d{1,5})/i
  );
  const inventoryBadgeMatch = compact.match(
    /(in stock|out of stock|low stock|limited stock|few left|selling fast|ships within\s+\d+\s+days)/i
  );
  const evidenceMatch = compact.match(
    /(out of stock|sold out|currently unavailable|in stock|low stock|limited stock|few left|selling fast|available quantity\s*[:=]?\s*\d+)/i
  );

  return {
    evidenceText: evidenceMatch?.[0] ? sliceEvidence(evidenceMatch[0]) : null,
    inventoryBadge: inventoryBadgeMatch?.[0] ? sliceEvidence(inventoryBadgeMatch[0]) : null,
    stockCount: stockMatch ? Number(stockMatch[1] ?? stockMatch[2]) : null,
  };
}

function buildAliExpressSearchUrl(keyword: string): string {
  return `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(keyword).replace(
    /%20/g,
    "-"
  )}.html?SearchText=${encodeURIComponent(keyword)}`;
}

function normalizeAliExpressItemUrl(url: string, itemId: string): string {
  if (!url) return `https://www.aliexpress.com/item/${itemId}.html`;
  const normalized = url.replace(/^http:\/\//i, "https://");
  return normalized.includes("aliexpress.com/item/") || normalized.includes("aliexpress.us/item/")
    ? normalized
    : `https://www.aliexpress.com/item/${itemId}.html`;
}

function extractPriceFromItemUrl(url: string): string | null {
  const decoded = decodeURIComponent(url);
  const pdp = decoded.match(/pdp_npi=([^&]+)/i)?.[1];
  if (!pdp) return null;

  const numericParts = pdp
    .split("!")
    .map((part) => part.trim())
    .filter((part) => /^[0-9]+(?:\.[0-9]{1,2})?$/.test(part));

  if (numericParts.length >= 2) return numericParts[1];
  if (numericParts.length === 1) return numericParts[0];
  return null;
}

function extractPriceNear(text: string, offset: number): string | null {
  const left = text.slice(Math.max(0, offset - 500), offset);
  const headingMatches = Array.from(left.matchAll(/###\s+[^\n]{8,300}?\s+\$([0-9]+(?:\.[0-9]{1,2})?)/g));
  if (headingMatches.length) {
    return headingMatches[headingMatches.length - 1]?.[1] ?? null;
  }
  const matches = Array.from(left.matchAll(/\$([0-9]+(?:\.[0-9]{1,2})?)/g));
  if (!matches.length) return null;
  return matches[matches.length - 1]?.[1] ?? null;
}

function extractTitleNear(text: string, offset: number): string | null {
  const left = text.slice(Math.max(0, offset - 1200), offset);
  const headingMatches = Array.from(left.matchAll(/###\s+([^\n$]{8,300}?)(?:\s+\$[0-9]|$)/g));
  if (headingMatches.length) {
    const candidate = headingMatches[headingMatches.length - 1]?.[1]?.trim();
    if (candidate) return candidate;
  }

  const altMatches = Array.from(left.matchAll(/!\[Image \d+: ([^\]\n]{8,300})\]/g));
  if (altMatches.length) {
    const candidate = altMatches[altMatches.length - 1]?.[1]?.trim();
    if (candidate) return candidate;
  }

  return null;
}

function extractImageNear(text: string, offset: number): string[] {
  const left = text.slice(Math.max(0, offset - 1500), offset);
  const imageMatches = Array.from(
    left.matchAll(/\((https?:\/\/[^)\s]*ae[-\w.]*aliexpress[^)\s]*|https?:\/\/[^)\s]*ae01\.alicdn\.com[^)\s]*)\)/g)
  );
  const image =
    imageMatches.find((m) => /\.(jpg|jpeg|png|avif)/i.test(m[1]) && /480x|960x|\.jpg/i.test(m[1]))?.[1] ??
    imageMatches[imageMatches.length - 1]?.[1];
  return image ? [image.replace(/^http:\/\//i, "https://")] : [];
}

function parseAliExpressText(text: string, keyword: string, snapshotTs: string): SupplierProduct[] {
  const out: SupplierProduct[] = [];
  const seen = new Set<string>();
  const itemUrlRegex = /https?:\/\/www\.aliexpress\.(?:us|com)\/item\/(\d+)\.html[^\s)\]]*/gi;

  for (const match of text.matchAll(itemUrlRegex)) {
    const rawUrl = match[0];
    const itemId = match[1];
    const idx = match.index ?? 0;

    if (!itemId || seen.has(itemId)) continue;

    const nearbyText = text.slice(Math.max(0, idx - 460), idx + 460);
    const title = extractTitleNear(text, idx);
    const priceEvidence = extractPriceEvidence(nearbyText);
    const price = extractPriceFromItemUrl(rawUrl) ?? extractPriceNear(text, idx) ?? priceEvidence.price;
    const images = extractImageNear(text, idx);
    const sourceUrl = normalizeAliExpressItemUrl(rawUrl, itemId);
    const inferredAvailability = inferAvailabilityFromText(nearbyText);
    const availabilityEvidence = extractAvailabilityEvidence(nearbyText);
    const shipping = extractShippingEvidence(nearbyText);
    const listingValidity = inferListingValidity(nearbyText);

    seen.add(itemId);

    out.push({
      title,
      price,
      currency: "USD",
      images,
      variants: [],
      sourceUrl,
      supplierProductId: itemId,
      shippingEstimates: shipping.shippingEstimates,
      platform: "AliExpress",
      keyword,
      snapshotTs,
      availabilitySignal: inferredAvailability.signal,
      availabilityConfidence: inferredAvailability.confidence,
      telemetrySignals: ["parsed"],
      raw: {
        provider: "aliexpress-search",
        parseMode: "text",
        matchedItemUrl: rawUrl,
        availabilitySignal: inferredAvailability.signal,
        availabilityConfidence: inferredAvailability.confidence,
        availabilityEvidencePresent: Boolean(
          availabilityEvidence.evidenceText ||
            availabilityEvidence.inventoryBadge ||
            availabilityEvidence.stockCount != null
        ),
        availabilityEvidenceQuality: inferredAvailability.signal === "UNKNOWN" ? "MEDIUM" : "HIGH",
        availabilityEvidenceText: availabilityEvidence.evidenceText,
        inventoryBadge: availabilityEvidence.inventoryBadge,
        stockCount: availabilityEvidence.stockCount,
        priceText: priceEvidence.priceText,
        priceSignal: priceEvidence.signal,
        shippingSignal: shipping.signal,
        shippingEvidenceText: shipping.evidenceText,
        shipsFromHint: shipping.shipsFromHint,
        listingValidity: listingValidity.status,
        listingValidityReason: listingValidity.reason,
        nearbyTextSample: sliceEvidence(nearbyText),
        crawlStatus: "PARSED",
        telemetrySignals: ["parsed"],
      },
    });

    if (out.length >= MAX_RESULTS) break;
  }

  return out;
}

async function fetchAliExpressSearchText(searchUrl: string): Promise<{ text: string; mode: string }> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  try {
    const res = await fetch(searchUrl, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    const antiBot = text.includes("_____tmd_____/punish") || text.includes("window._config_");
    if (res.ok && !antiBot) {
      return { text, mode: "direct" };
    }
  } catch {
    // fall through to read-through fetch
  }

  const proxyUrl = `https://r.jina.ai/http://${searchUrl.replace(/^https?:\/\//, "")}`;
  const res = await fetch(proxyUrl, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new Error(`AliExpress read-through fetch failed: ${res.status}`);
  }
  return { text: await res.text(), mode: "read-through" };
}

export async function searchAliExpressByKeyword(
  keyword: string,
  limit = 20
): Promise<SupplierProduct[]> {
  const capped = Math.min(Math.max(limit, 1), MAX_RESULTS);
  const snapshotTs = new Date().toISOString();
  const normalizedKeyword = String(keyword ?? "").trim();
  if (!normalizedKeyword) return [];
  const searchUrl = buildAliExpressSearchUrl(normalizedKeyword);
  const fallbackRaw: Record<string, unknown> = {
    mode: "stub-fallback",
    parseMode: "fallback",
    provider: "aliexpress-search",
    keyword: normalizedKeyword,
    platform: "AliExpress",
    searchUrl,
    crawlStatus: "NO_PRODUCTS_PARSED",
    availabilitySignal: "UNKNOWN",
    availabilityConfidence: 0.12,
    availabilityEvidencePresent: false,
    availabilityEvidenceQuality: "LOW",
    listingValidity: "POSSIBLE_STALE",
    priceSignal: "FALLBACK",
    shippingSignal: "MISSING",
    telemetrySignals: ["fallback", "low_quality"],
  };

  try {
    const fetched = await fetchAliExpressSearchText(searchUrl);
    const challengePage = looksLikeAliExpressChallengePage(fetched.text);
    const challengeHint = extractAliExpressChallengeHint(fetched.text);
    fallbackRaw.fetchMode = fetched.mode;
    fallbackRaw.pageChallengeDetected = challengePage;
    fallbackRaw.challengeHint = challengeHint;
    fallbackRaw.pageTextSample = challengeHint ? sliceEvidence(challengeHint) : null;
    fallbackRaw.crawlStatus = challengePage ? "CHALLENGE_PAGE" : "NO_PRODUCTS_PARSED";
    fallbackRaw.telemetrySignals = challengePage
      ? ["fallback", "challenge", "low_quality"]
      : ["fallback", "low_quality"];
    const rows = parseAliExpressText(fetched.text, normalizedKeyword, snapshotTs)
      .filter((row) => row.title || row.supplierProductId)
      .slice(0, capped)
      .map((row) => ({
        ...row,
        raw: {
          ...row.raw,
          fetchMode: fetched.mode,
          searchUrl,
          pageChallengeDetected: challengePage,
        },
      }));

    if (rows.length) {
      console.log(
        `[supplier][AliExpress] keyword="${normalizedKeyword}" fetchMode=${fetched.mode} results=${rows.length}`
      );
      return rows;
    }

  } catch (error) {
    fallbackRaw.crawlStatus = "FETCH_FAILED";
    fallbackRaw.fetchError = error instanceof Error ? error.message : String(error);
    console.error(`[supplier][AliExpress] keyword="${normalizedKeyword}" failed`, {
      error: error instanceof Error ? error.message : String(error),
      searchUrl,
    });
  }

  const fallbackRows: SupplierProduct[] = [
    {
      title: `${normalizedKeyword} sample from AliExpress`,
      price: "9.95",
      currency: "USD",
      images: [],
      variants: [],
      sourceUrl: searchUrl,
      supplierProductId: `aliexpress-${normalizedKeyword.toLowerCase().replace(/\s+/g, "-")}-1`,
      shippingEstimates: [],
      platform: "AliExpress",
      keyword: normalizedKeyword,
      snapshotTs,
      availabilitySignal: "UNKNOWN",
      availabilityConfidence: 0.12,
      snapshotQuality: "STUB",
      telemetrySignals: Array.isArray(fallbackRaw.telemetrySignals)
        ? (fallbackRaw.telemetrySignals as SupplierProduct["telemetrySignals"])
        : ["fallback", "low_quality"],
      raw: {
        ...fallbackRaw,
      },
    },
  ];

  return fallbackRows.slice(0, capped);
}
