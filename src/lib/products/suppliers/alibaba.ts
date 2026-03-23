import type { SupplierProduct } from "./types";
import { inferAvailabilityFromText } from "@/lib/products/supplierAvailability";
import {
  compactText,
  extractPriceEvidence,
  extractShippingEvidence,
  inferListingValidity,
  sliceEvidence,
} from "./parserSignals";
import { fetchSupplierPageWithFallback } from "./fetchWithFallback";

const MAX_RESULTS = 20;

function looksLikeAlibabaChallengePage(text: string): boolean {
  const compact = compactText(text).toLowerCase();
  if (!compact) return false;
  return (
    compact.includes("security verification") ||
    compact.includes("unusual traffic") ||
    compact.includes("_____tmd_____/punish") ||
    compact.includes("captcha-h5-tips") ||
    compact.includes("slide to complete the puzzle") ||
    compact.includes("punish-page")
  );
}

function extractAlibabaChallengeHint(text: string): string | null {
  const compact = compactText(text).toLowerCase();
  if (!compact) return null;
  const match = compact.match(
    /(security verification|unusual traffic|slide to complete the puzzle|detected unusual traffic)/i
  );
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
    /(?:stock|inventory|available quantity)\s*[:=]?\s*(\d{1,5})|(?:only|just)\s+(\d{1,5})\s+(?:left|units?|pieces?|items?)\b/i
  );
  const inventoryBadgeMatch = compact.match(
    /(in stock|out of stock|low stock|limited stock|few left|ready to ship|ships within\s+\d+\s+days)/i
  );
  const sellerStatusMatch = compact.match(
    /(store closed|seller unavailable|supplier unavailable|unusual traffic|security verification|captcha)/i
  );
  const evidenceMatch = compact.match(
    /(out of stock|sold out|currently unavailable|in stock|low stock|limited stock|few left|ready to ship|ships within\s+\d+\s+days|available quantity\s*[:=]?\s*\d+)/i
  );

  return {
    evidenceText: evidenceMatch?.[0] ? sliceEvidence(evidenceMatch[0]) : null,
    inventoryBadge: inventoryBadgeMatch?.[0] ? sliceEvidence(inventoryBadgeMatch[0]) : null,
    stockCount: stockMatch ? Number(stockMatch[1] ?? stockMatch[2]) : null,
    sellerStatusHint: sellerStatusMatch?.[0] ? sliceEvidence(sellerStatusMatch[0]) : null,
  };
}

function buildAlibabaSearchUrl(keyword: string): string {
  return `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(keyword)}`;
}

function normalizeAlibabaItemUrl(url: string): string {
  const normalized = String(url || "").replace(/^http:\/\//i, "https://");
  return normalized.includes("alibaba.com/") ? normalized : "";
}

function extractAlibabaProductId(url: string): string | null {
  const normalized = normalizeAlibabaItemUrl(url);
  if (!normalized) return null;
  const detailId = normalized.match(/_(\d{8,})\.html/i)?.[1];
  if (detailId) return detailId;
  const idFromQuery = normalized.match(/[?&](?:productId|product_id|id)=(\d{8,})/i)?.[1];
  return idFromQuery ?? null;
}

function extractTitleNear(text: string, offset: number): string | null {
  const left = text.slice(Math.max(0, offset - 1600), offset);
  const headingMatches = Array.from(left.matchAll(/###\s+([^\n]{8,300})/g));
  if (headingMatches.length) {
    const candidate = headingMatches[headingMatches.length - 1]?.[1]?.trim();
    if (candidate) return candidate;
  }
  return null;
}

function extractPriceNear(text: string, offset: number): string | null {
  const left = text.slice(Math.max(0, offset - 600), offset + 140);
  const matches = Array.from(left.matchAll(/\$([0-9]+(?:\.[0-9]{1,2})?)/g));
  if (!matches.length) return null;
  return matches[matches.length - 1]?.[1] ?? null;
}

function extractImageNear(text: string, offset: number): string[] {
  const left = text.slice(Math.max(0, offset - 2000), offset);
  const imageMatches = Array.from(
    left.matchAll(/\((https?:\/\/[^)\s]*(?:alicdn\.com|aliimg\.com|alibaba\.com)[^)\s]*)\)/g)
  );
  const image =
    imageMatches.find((m) => /\.(jpg|jpeg|png|webp|avif)/i.test(m[1]))?.[1] ??
    imageMatches[imageMatches.length - 1]?.[1];
  return image ? [image.replace(/^http:\/\//i, "https://")] : [];
}

function extractDetailTitle(text: string): string | null {
  const compact = String(text ?? "");
  const headingMatch =
    compact.match(/(?:^|\n)#{1,3}\s+([^\n]{8,220})/) ??
    compact.match(/title[:=]?\s*([^\n]{8,220})/i);
  return headingMatch?.[1] ? sliceEvidence(headingMatch[1], 220) : null;
}

function extractDetailImages(text: string): string[] {
  const matches = Array.from(
    String(text ?? "").matchAll(/https?:\/\/[^\s)"']*(?:alibaba\.com|alicdn\.com|aliimg\.com)[^\s)"']*/gi)
  )
    .map((match) => String(match[0] ?? "").replace(/^http:\/\//i, "https://"))
    .filter((url) => /\.(jpg|jpeg|png|webp|avif)/i.test(url));

  return Array.from(new Set(matches)).slice(0, 48);
}

async function fetchAlibabaDetailText(detailUrl: string): Promise<{ text: string; mode: string }> {
  const fetched = await fetchSupplierPageWithFallback({
    url: detailUrl,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    validate: ({ text, status }) => status >= 200 && status < 300 && text.length > 500 && !looksLikeAlibabaChallengePage(text),
  });
  return { text: fetched.text, mode: fetched.mode };
}

async function enrichAlibabaProductWithDetail(product: SupplierProduct): Promise<SupplierProduct> {
  const detailUrl = normalizeAlibabaItemUrl(product.sourceUrl);
  if (!detailUrl) return product;

  try {
    const fetched = await fetchAlibabaDetailText(detailUrl);
    if (looksLikeAlibabaChallengePage(fetched.text)) {
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
      snapshotQuality: evidencePresent || shipping.shippingEstimates.length || mergedImages.length ? "MEDIUM" : product.snapshotQuality,
      raw: {
        ...product.raw,
        provider: "alibaba-detail",
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
        listingValidity: listingValidity.status,
        listingValidityReason: listingValidity.reason,
        detailTextSample: sliceEvidence(fetched.text),
        crawlStatus: "PARSED",
        telemetrySignals: ["parsed"],
      },
    };
  } catch {
    return product;
  }
}

function parseAlibabaText(text: string, keyword: string, snapshotTs: string): SupplierProduct[] {
  const out: SupplierProduct[] = [];
  const seen = new Set<string>();
  const itemUrlRegex = /https?:\/\/www\.alibaba\.com\/(?:product-detail|product)\/[^\s)\]]+/gi;

  for (const match of text.matchAll(itemUrlRegex)) {
    const rawUrl = match[0];
    const idx = match.index ?? 0;
    const sourceUrl = normalizeAlibabaItemUrl(rawUrl);
    if (!sourceUrl) continue;

    const supplierProductId = extractAlibabaProductId(sourceUrl) ?? sourceUrl;
    if (!supplierProductId || seen.has(supplierProductId)) continue;

    const nearbyText = text.slice(Math.max(0, idx - 520), idx + 520);
    const inferredAvailability = inferAvailabilityFromText(nearbyText);
    const evidence = extractAvailabilityEvidence(nearbyText);
    const shipping = extractShippingEvidence(nearbyText);
    const priceEvidence = extractPriceEvidence(nearbyText);
    const listingValidity = inferListingValidity(nearbyText);
    const evidenceQuality = inferredAvailability.signal === "UNKNOWN" ? "MEDIUM" : "HIGH";
    const price = extractPriceNear(text, idx) ?? priceEvidence.price;

    seen.add(supplierProductId);
    out.push({
      title: extractTitleNear(text, idx),
      price,
      currency: "USD",
      images: extractImageNear(text, idx),
      variants: [],
      sourceUrl,
      supplierProductId,
      shippingEstimates: shipping.shippingEstimates,
      platform: "Alibaba",
      keyword,
      snapshotTs,
      availabilitySignal: inferredAvailability.signal,
      availabilityConfidence: inferredAvailability.confidence,
      telemetrySignals: ["parsed"],
      raw: {
        provider: "alibaba-search",
        parseMode: "text",
        matchedItemUrl: rawUrl,
        availabilitySignal: inferredAvailability.signal,
        availabilityConfidence: inferredAvailability.confidence,
        availabilityEvidencePresent: Boolean(
          evidence.evidenceText || evidence.inventoryBadge || evidence.stockCount != null || evidence.sellerStatusHint
        ),
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

async function fetchAlibabaSearchText(searchUrl: string): Promise<{ text: string; mode: string }> {
  const fetched = await fetchSupplierPageWithFallback({
    url: searchUrl,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    validate: ({ text, status }) => status >= 200 && status < 300 && text.length > 500 && !looksLikeAlibabaChallengePage(text),
  });
  return { text: fetched.text, mode: fetched.mode };
}

async function fetchAlibabaSearchFallbackText(searchUrl: string): Promise<{ text: string; mode: string }> {
  const fetched = await fetchSupplierPageWithFallback({
    url: searchUrl,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    validate: ({ text, status }) => status >= 200 && status < 300 && text.length > 500 && !looksLikeAlibabaChallengePage(text),
    skipModes: ["direct"],
  });
  return { text: fetched.text, mode: fetched.mode };
}

export async function searchAlibabaByKeyword(
  keyword: string,
  limit = 20
): Promise<SupplierProduct[]> {
  const capped = Math.min(Math.max(limit, 1), MAX_RESULTS);
  const snapshotTs = new Date().toISOString();
  const normalizedKeyword = String(keyword ?? "").trim();
  if (!normalizedKeyword) return [];
  const searchUrl = buildAlibabaSearchUrl(normalizedKeyword);
  const fallbackRaw: Record<string, unknown> = {
    mode: "stub-fallback",
    parseMode: "fallback",
    provider: "alibaba-search",
    keyword: normalizedKeyword,
    platform: "Alibaba",
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
    const fetched = await fetchAlibabaSearchText(searchUrl);
    const challengePage = looksLikeAlibabaChallengePage(fetched.text);
    const challengeHint = extractAlibabaChallengeHint(fetched.text);
    let rows = parseAlibabaText(fetched.text, normalizedKeyword, snapshotTs)
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
      effectiveFetched = await fetchAlibabaSearchFallbackText(searchUrl);
      effectiveChallengePage = looksLikeAlibabaChallengePage(effectiveFetched.text);
      effectiveChallengeHint = extractAlibabaChallengeHint(effectiveFetched.text);
      rows = parseAlibabaText(effectiveFetched.text, normalizedKeyword, snapshotTs)
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

    if (rows.length) {
      const enrichedRows = await Promise.all(rows.map((row) => enrichAlibabaProductWithDetail(row)));
      console.log(`[supplier][Alibaba] keyword="${normalizedKeyword}" fetchMode=${effectiveFetched.mode} results=${rows.length}`);
      return enrichedRows;
    }
  } catch (error) {
    fallbackRaw.crawlStatus = "FETCH_FAILED";
    fallbackRaw.fetchError = error instanceof Error ? error.message : String(error);
    console.error(`[supplier][Alibaba] keyword="${normalizedKeyword}" failed`, {
      error: error instanceof Error ? error.message : String(error),
      searchUrl,
    });
  }

  // Fail-safe fallback keeps discovery path active when upstream parsing is sparse.
  const fallbackRows: SupplierProduct[] = [
    {
      title: `${normalizedKeyword} sample from Alibaba`,
      price: "12.50",
      currency: "USD",
      images: [],
      variants: [],
      sourceUrl: searchUrl,
      supplierProductId: `alibaba-${normalizedKeyword.toLowerCase().replace(/\s+/g, "-")}-1`,
      shippingEstimates: [],
      platform: "Alibaba",
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
