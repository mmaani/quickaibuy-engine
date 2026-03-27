import type { SupplierProduct } from "./types";
import { inferAvailabilityFromText } from "@/lib/products/supplierAvailability";
import {
  compactText,
  extractPriceEvidence,
  extractShippingEvidence,
  inferListingValidity,
  looksLikeProviderBlockPayload,
  sliceEvidence,
} from "./parserSignals";
import { fetchSupplierPageWithFallback } from "./fetchWithFallback";

const MAX_RESULTS = 20;

function looksLikeAliExpressChallengePage(text: string): boolean {
  const compact = compactText(text).toLowerCase();
  if (!compact) return false;
  return (
    looksLikeProviderBlockPayload(text) ||
    compact.includes("_____tmd_____/punish") ||
    compact.includes("captcha") ||
    compact.includes("security verification") ||
    compact.includes("punish-page")
  );
}

function looksLikeAliExpressDetailError(text: string): boolean {
  const compact = compactText(text).toLowerCase();
  if (!compact) return false;
  return (
    looksLikeAliExpressChallengePage(text) ||
    compact.includes("usage exceeded (auth004)") ||
    compact.includes("docs.zenrows.com/api-error-codes") ||
    compact.includes("\"type\":\"https://docs.zenrows.com") ||
    compact.includes("\"code\":\"auth004\"") ||
    compact.includes("\"status\":401") ||
    compact.includes("\"title\":\"unauthorized\"") ||
    compact.includes("404 page") ||
    compact.includes("page not found") ||
    compact.includes("error 404")
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
  sellerStatusHint: string | null;
} {
  const compact = compactText(rawText);
  if (!compact) {
    return { evidenceText: null, inventoryBadge: null, stockCount: null, sellerStatusHint: null };
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
  const sellerStatusMatch = compact.match(
    /(seller unavailable|store closed|security verification|captcha|punish-page|challenge)/i
  );

  return {
    evidenceText: evidenceMatch?.[0] ? sliceEvidence(evidenceMatch[0]) : null,
    inventoryBadge: inventoryBadgeMatch?.[0] ? sliceEvidence(inventoryBadgeMatch[0]) : null,
    stockCount: stockMatch ? Number(stockMatch[1] ?? stockMatch[2]) : null,
    sellerStatusHint: sellerStatusMatch?.[0] ? sliceEvidence(sellerStatusMatch[0]) : null,
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

function normalizeAliExpressDetailUrl(url: string): string {
  const normalized = String(url || "")
    .replace(/^http:\/\//i, "https://")
    .replace(/[):,.;]+$/g, "");
  return normalized.includes("aliexpress.com/item/") || normalized.includes("aliexpress.us/item/")
    ? normalized
    : "";
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

function normalizeTitleToken(value: string | null): string {
  return compactText(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function extractImagesNear(text: string, offset: number, title: string | null): string[] {
  const left = text.slice(Math.max(0, offset - 2400), offset);
  const normalizedTitle = normalizeTitleToken(title);
  const productImageMatches = Array.from(
    left.matchAll(
      /!\[Image \d+: ([^\]\n]{8,300})\]\((https?:\/\/[^)\s]*(?:aliexpress-media\.com|alicdn\.com)[^)\s]*)\)/gi
    )
  );
  const filteredMatches = productImageMatches.filter((match) => {
    const altText = normalizeTitleToken(match[1]);
    const url = match[2];
    if (!url || /\/(?:27x27|45x60|48x48|60x60|64x64|72x72|116x64|154x64)\./i.test(url)) return false;
    if (!/\.(jpg|jpeg|png|avif)/i.test(url) || !/(480x480|960x960|\.jpg|\.png|\.avif)/i.test(url)) return false;
    if (!normalizedTitle) return true;
    return altText === normalizedTitle || altText.includes(normalizedTitle) || normalizedTitle.includes(altText);
  });

  const matches = filteredMatches.length ? filteredMatches : productImageMatches;
  const images: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const normalized = match[2].replace(/^http:\/\//i, "https://");
    if (!normalized || seen.has(normalized)) continue;
    if (/\/(?:27x27|45x60|48x48|60x60|64x64|72x72|116x64|154x64)\./i.test(normalized)) continue;
    seen.add(normalized);
    images.push(normalized);
  }
  return images.slice(-8);
}

function extractDetailTitle(text: string): string | null {
  const compact = String(text ?? "");
  const headingMatch =
    compact.match(/(?:^|\n)#{1,3}\s+([^\n]{8,220})/) ??
    compact.match(/title[:=]?\s*([^\n]{8,220})/i);
  const candidate = headingMatch?.[1] ? sliceEvidence(headingMatch[1], 220) : null;
  if (!candidate || looksLikeAliExpressDetailError(candidate)) return null;
  return candidate;
}

function extractDetailImages(text: string): string[] {
  const matches = Array.from(
    String(text ?? "").matchAll(/https?:\/\/[^\s)"']*(?:aliexpress-media\.com|alicdn\.com)[^\s)"']*/gi)
  )
    .map((match) => String(match[0] ?? "").replace(/^http:\/\//i, "https://"))
    .filter((url) => /\.(jpg|jpeg|png|webp|avif)/i.test(url));

  return Array.from(new Set(matches)).slice(0, 48);
}

function extractMerchandisingSignals(rawText: string): {
  rating: number | null;
  soldCount: number | null;
  soldText: string | null;
  shippingBadge: string | null;
} {
  const compact = compactText(rawText);
  if (!compact) {
    return { rating: null, soldCount: null, soldText: null, shippingBadge: null };
  }

  const ratingSoldMatch = compact.match(/([0-5]\.[0-9])\s+([0-9][0-9,]*\+?\s+sold)/i);
  const shippingBadgeMatch = compact.match(/\b(dollar express|choice|free shipping|fast delivery)\b/i);
  const soldCount = ratingSoldMatch?.[2]
    ? Number(ratingSoldMatch[2].replace(/[^0-9]/g, ""))
    : null;

  return {
    rating: ratingSoldMatch?.[1] ? Number(ratingSoldMatch[1]) : null,
    soldCount: Number.isFinite(soldCount ?? NaN) ? soldCount : null,
    soldText: ratingSoldMatch?.[2] ? sliceEvidence(ratingSoldMatch[2]) : null,
    shippingBadge: shippingBadgeMatch?.[1] ? sliceEvidence(shippingBadgeMatch[1]) : null,
  };
}

function deriveAliExpressAvailability(input: {
  nearbyText: string;
  title: string | null;
  images: string[];
  sourceUrl: string;
  listingValidity: { status: string; reason: string | null };
  merchandising: ReturnType<typeof extractMerchandisingSignals>;
}): {
  signal: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  confidence: number;
  evidenceText: string | null;
  quality: "HIGH" | "MEDIUM" | "LOW";
} {
  const inferred = inferAvailabilityFromText(input.nearbyText);
  const evidence = extractAvailabilityEvidence(input.nearbyText);

  if (inferred.signal !== "UNKNOWN") {
    return {
      signal: inferred.signal,
      confidence: inferred.confidence,
      evidenceText: evidence.evidenceText ?? evidence.inventoryBadge,
      quality: inferred.signal === "IN_STOCK" ? "HIGH" : "MEDIUM",
    };
  }

  const strongActiveCard =
    input.listingValidity.status === "VALID" &&
    Boolean(input.title) &&
    input.images.length >= 4 &&
    Boolean(input.sourceUrl) &&
    input.merchandising.rating != null &&
    input.merchandising.rating >= 4 &&
    input.merchandising.soldCount != null &&
    input.merchandising.soldCount >= 100;

  if (strongActiveCard) {
    const soldCount = input.merchandising.soldCount ?? 0;
    const confidence = soldCount >= 1000 || (input.merchandising.rating ?? 0) >= 4.7 ? 0.74 : 0.68;
    const evidenceText = sliceEvidence(
      `active search card rating ${input.merchandising.rating} ${input.merchandising.soldText ?? `${soldCount} sold`}`
    );
    return {
      signal: "IN_STOCK",
      confidence,
      evidenceText,
      quality: "MEDIUM",
    };
  }

  return {
    signal: inferred.signal,
    confidence: inferred.confidence,
    evidenceText: evidence.evidenceText ?? evidence.inventoryBadge,
    quality: "LOW",
  };
}

function deriveAliExpressShipping(
  nearbyText: string,
  merchandising: ReturnType<typeof extractMerchandisingSignals>
): {
  shippingEstimates: SupplierProduct["shippingEstimates"];
  evidenceText: string | null;
  shipsFromHint: string | null;
  shipFromCountry: string | null;
  shipFromLocation: string | null;
  shippingGuarantee: string | null;
  signal: "DIRECT" | "PARTIAL" | "INFERRED" | "MISSING";
  shippingConfidence: number;
  shippingMethod: string | null;
} {
  const shipping = extractShippingEvidence(nearbyText);
  const shippingMethod = merchandising.shippingBadge ?? shipping.evidenceText ?? null;
  const shippingConfidence =
    shipping.signal === "DIRECT"
      ? 0.9
      : shipping.signal === "PARTIAL"
        ? shipping.shipFromCountry === "US"
          ? 0.84
          : 0.58
      : merchandising.shippingBadge && /(dollar express|choice|free shipping|fast delivery)/i.test(merchandising.shippingBadge)
        ? 0.78
        : shipping.signal === "INFERRED"
          ? 0.62
          : 0.2;

  const shippingEstimates =
    shipping.shippingEstimates.length > 0
      ? shipping.shippingEstimates
      : shippingMethod
        ? [
            {
              label: shippingMethod,
              cost: /free shipping/i.test(shippingMethod) ? "0" : null,
              currency: /free shipping/i.test(shippingMethod) ? "USD" : null,
            },
          ]
        : [];

  return {
    shippingEstimates,
    evidenceText: shipping.evidenceText ?? shippingMethod,
    shipsFromHint: shipping.shipsFromHint,
    shipFromCountry: shipping.shipFromCountry,
    shipFromLocation: shipping.shipFromLocation,
    shippingGuarantee: shipping.shippingGuarantee,
    signal:
      shipping.signal !== "MISSING"
        ? shipping.signal
        : shippingMethod
          ? "INFERRED"
          : "MISSING",
    shippingConfidence,
    shippingMethod,
  };
}

async function fetchAliExpressDetailText(detailUrl: string): Promise<{ text: string; mode: string }> {
  const fetched = await fetchSupplierPageWithFallback({
    url: detailUrl,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    validate: ({ text, status }) =>
      status >= 200 && status < 300 && text.length > 500 && !looksLikeAliExpressDetailError(text),
  });
  if (looksLikeAliExpressDetailError(fetched.text)) {
    throw new Error("AliExpress detail fetch returned non-product error payload");
  }
  return { text: fetched.text, mode: fetched.mode };
}

async function enrichAliExpressProductWithDetail(product: SupplierProduct): Promise<SupplierProduct> {
  const detailUrl = normalizeAliExpressDetailUrl(product.sourceUrl);
  if (!detailUrl) return product;

  try {
    const fetched = await fetchAliExpressDetailText(detailUrl);
    if (looksLikeAliExpressDetailError(fetched.text)) {
      return product;
    }

    const inferredAvailability = inferAvailabilityFromText(fetched.text);
    const evidence = extractAvailabilityEvidence(fetched.text);
    const shipping = extractShippingEvidence(fetched.text);
    const priceEvidence = extractPriceEvidence(fetched.text);
    const listingValidity = inferListingValidity(fetched.text);
    if (listingValidity.status === "INVALID") {
      return product;
    }

    const title = extractDetailTitle(fetched.text) ?? product.title;
    const images = extractDetailImages(fetched.text);
    const mergedImages = Array.from(new Set([...(product.images ?? []), ...images])).slice(0, 48);
    const availabilitySignal =
      inferredAvailability.signal !== "UNKNOWN"
        ? inferredAvailability.signal
        : product.availabilitySignal ?? "UNKNOWN";
    const availabilityConfidence =
      inferredAvailability.signal !== "UNKNOWN"
        ? inferredAvailability.confidence
        : (product.availabilityConfidence ?? 0.35);
    const evidencePresent = Boolean(
      evidence.evidenceText || evidence.inventoryBadge || evidence.stockCount != null || evidence.sellerStatusHint
    );
    const evidenceQuality = availabilitySignal === "UNKNOWN" ? "MEDIUM" : "HIGH";

    return {
      ...product,
      title,
      price: priceEvidence.price ?? product.price,
      images: mergedImages.length ? mergedImages : product.images,
      shippingEstimates: shipping.shippingEstimates.length ? shipping.shippingEstimates : product.shippingEstimates,
      availabilitySignal,
      availabilityConfidence,
      snapshotQuality:
        evidencePresent || shipping.shippingEstimates.length || mergedImages.length ? "MEDIUM" : product.snapshotQuality,
      raw: {
        ...product.raw,
        provider: "aliexpress-detail",
        parseMode: "detail",
        detailUrl,
        detailFetchMode: fetched.mode,
        availabilitySignal,
        availabilityConfidence,
        availabilityEvidencePresent: evidencePresent,
        availabilityEvidenceQuality: evidenceQuality,
        availabilityEvidenceText: evidence.evidenceText,
        inventoryBadge: evidence.inventoryBadge,
        stockCount: evidence.stockCount,
        sellerStatusHint: evidence.sellerStatusHint,
        priceText: priceEvidence.priceText,
        priceSignal: priceEvidence.signal,
        shippingSignal: shipping.signal,
        shippingEvidenceText: shipping.evidenceText,
        shipsFromHint: shipping.shipsFromHint,
        shipFromCountry: shipping.shipFromCountry,
        ship_from_country: shipping.shipFromCountry,
        shipFromLocation: shipping.shipFromLocation,
        ship_from_location: shipping.shipFromLocation,
        shippingGuarantee: shipping.shippingGuarantee,
        listingValidity: listingValidity.status,
        listingValidityReason: listingValidity.reason,
        evidenceSource: "product_detail",
        detailQuality: fetched.mode === "direct" ? "HIGH" : "MEDIUM",
        enrichmentQuality: shipping.signal === "DIRECT" ? "HIGH" : "MEDIUM",
        detailTextSample: sliceEvidence(fetched.text),
        crawlStatus: "PARSED",
        telemetrySignals: ["parsed"],
      },
    };
  } catch {
    return product;
  }
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
    const images = extractImagesNear(text, idx, title);
    const sourceUrl = normalizeAliExpressItemUrl(rawUrl, itemId);
    const listingValidity = inferListingValidity(nearbyText);
    const merchandising = extractMerchandisingSignals(nearbyText);
    const availability = deriveAliExpressAvailability({
      nearbyText,
      title,
      images,
      sourceUrl,
      listingValidity,
      merchandising,
    });
    const availabilityEvidence = extractAvailabilityEvidence(nearbyText);
    const shipping = deriveAliExpressShipping(nearbyText, merchandising);

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
      availabilitySignal: availability.signal,
      availabilityConfidence: availability.confidence,
      telemetrySignals: ["parsed"],
      raw: {
        provider: "aliexpress-search",
        parseMode: "text",
        matchedItemUrl: rawUrl,
        availabilitySignal: availability.signal,
        availabilityConfidence: availability.confidence,
        availabilityEvidencePresent: Boolean(
          availability.evidenceText ||
            availabilityEvidence.evidenceText ||
            availabilityEvidence.inventoryBadge ||
            availabilityEvidence.stockCount != null
        ),
        availabilityEvidenceQuality: availability.quality,
        availabilityEvidenceText: availability.evidenceText ?? availabilityEvidence.evidenceText,
        inventoryBadge: availabilityEvidence.inventoryBadge,
        stockCount: availabilityEvidence.stockCount,
        priceText: priceEvidence.priceText,
        priceSignal: priceEvidence.signal,
        shippingSignal: shipping.signal,
        shippingEvidenceText: shipping.evidenceText,
        shippingBadge: merchandising.shippingBadge,
        shippingMethod: shipping.shippingMethod,
        shippingConfidence: shipping.shippingConfidence,
        shipsFromHint: shipping.shipsFromHint,
        shipFromCountry: shipping.shipFromCountry,
        ship_from_country: shipping.shipFromCountry,
        shipFromLocation: shipping.shipFromLocation,
        ship_from_location: shipping.shipFromLocation,
        shippingGuarantee: shipping.shippingGuarantee,
        ratingValue: merchandising.rating,
        soldCount: merchandising.soldCount,
        soldText: merchandising.soldText,
        imageGalleryCount: images.length,
        mediaQualityScore: images.length >= 5 ? 0.9 : images.length >= 4 ? 0.84 : images.length >= 2 ? 0.66 : 0.45,
        listingValidity: listingValidity.status,
        listingValidityReason: listingValidity.reason,
        evidenceSource: "search_card",
        detailQuality: "LOW",
        enrichmentQuality: shipping.signal === "DIRECT" ? "MEDIUM" : "LOW",
        nearbyTextSample: sliceEvidence(nearbyText),
        crawlStatus: "PARSED",
        telemetrySignals: ["parsed"],
      },
    });

    if (out.length >= MAX_RESULTS) break;
  }

  return out;
}

const ALIEXPRESS_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchAliExpressSearchText(searchUrl: string): Promise<{ text: string; mode: string }> {
  const headers = ALIEXPRESS_HEADERS;

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

async function fetchAliExpressSearchFallbackText(searchUrl: string): Promise<{ text: string; mode: string }> {
  const proxyUrl = `https://r.jina.ai/http://${searchUrl.replace(/^https?:\/\//, "")}`;
  const res = await fetch(proxyUrl, {
    method: "GET",
    headers: ALIEXPRESS_HEADERS,
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
    let rows = parseAliExpressText(fetched.text, normalizedKeyword, snapshotTs)
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

    let effectiveFetched = fetched;
    let effectiveChallengePage = challengePage;
    let effectiveChallengeHint = challengeHint;
    if (fetched.mode === "direct" && (challengePage || rows.length === 0)) {
      effectiveFetched = await fetchAliExpressSearchFallbackText(searchUrl);
      effectiveChallengePage = looksLikeAliExpressChallengePage(effectiveFetched.text);
      effectiveChallengeHint = extractAliExpressChallengeHint(effectiveFetched.text);
      rows = parseAliExpressText(effectiveFetched.text, normalizedKeyword, snapshotTs)
        .filter((row) => row.title || row.supplierProductId)
        .slice(0, capped)
        .map((row) => ({
          ...row,
          raw: {
            ...row.raw,
            fetchMode: effectiveFetched.mode,
            searchUrl,
            pageChallengeDetected: effectiveChallengePage,
          },
        }));
    }

    fallbackRaw.fetchMode = effectiveFetched.mode;
    fallbackRaw.pageChallengeDetected = effectiveChallengePage;
    fallbackRaw.challengeHint = effectiveChallengeHint;
    fallbackRaw.pageTextSample = effectiveChallengeHint ? sliceEvidence(effectiveChallengeHint) : null;
    fallbackRaw.crawlStatus = effectiveChallengePage ? "CHALLENGE_PAGE" : "NO_PRODUCTS_PARSED";
    fallbackRaw.telemetrySignals = effectiveChallengePage
      ? ["fallback", "challenge", "low_quality"]
      : ["fallback", "low_quality"];

    if (!effectiveChallengePage && rows.length) {
      const enrichedRows = await Promise.all(rows.map((row) => enrichAliExpressProductWithDetail(row)));
      console.log(
        `[supplier][AliExpress] keyword="${normalizedKeyword}" fetchMode=${effectiveFetched.mode} results=${rows.length}`
      );
      return enrichedRows;
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
