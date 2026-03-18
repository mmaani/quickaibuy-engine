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

function looksLikeTemuChallengePage(text: string): boolean {
  const compact = compactText(text).toLowerCase();
  if (!compact) return false;
  return (
    compact.includes("security verification") ||
    compact.includes("challenge") ||
    compact.includes("upload-static/assets/chl/js") ||
    compact.includes("slide to complete the puzzle") ||
    compact.includes("tc23efd25c84fedcab62d6a4f151de0fa4")
  );
}

function extractTemuChallengeHint(text: string): string | null {
  const compact = compactText(text).toLowerCase();
  if (!compact) return null;
  const match = compact.match(
    /(security verification|challenge|slide to complete the puzzle|anti-bot|captcha)/i
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
    /(seller unavailable|store closed|security verification|challenge|captcha)/i
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

function buildTemuSearchUrl(keyword: string): string {
  return `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(keyword)}`;
}

function normalizeTemuItemUrl(url: string): string {
  const normalized = String(url || "").replace(/^http:\/\//i, "https://");
  return normalized.includes("temu.com/") ? normalized : "";
}

function extractTemuProductId(url: string): string | null {
  const normalized = normalizeTemuItemUrl(url);
  if (!normalized) return null;
  const gId = normalized.match(/-g-(\d{8,})\.html/i)?.[1];
  if (gId) return gId;
  const goodsId = normalized.match(/[?&]goods_id=(\d{8,})/i)?.[1];
  return goodsId ?? null;
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
    left.matchAll(/\((https?:\/\/[^)\s]*(?:temu\.com|temucdn\.com)[^)\s]*)\)/g)
  );
  const image =
    imageMatches.find((m) => /\.(jpg|jpeg|png|webp|avif)/i.test(m[1]))?.[1] ??
    imageMatches[imageMatches.length - 1]?.[1];
  return image ? [image.replace(/^http:\/\//i, "https://")] : [];
}

function parseTemuText(text: string, keyword: string, snapshotTs: string): SupplierProduct[] {
  const out: SupplierProduct[] = [];
  const seen = new Set<string>();
  const itemUrlRegex =
    /https?:\/\/www\.temu\.com\/(?:[^)\s\]]*-g-\d+\.html[^\s)\]]*|goods\.html\?[^\s)\]]*goods_id=\d+[^\s)\]]*)/gi;

  for (const match of text.matchAll(itemUrlRegex)) {
    const rawUrl = match[0];
    const idx = match.index ?? 0;
    const sourceUrl = normalizeTemuItemUrl(rawUrl);
    if (!sourceUrl) continue;

    const supplierProductId = extractTemuProductId(sourceUrl) ?? sourceUrl;
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
      platform: "Temu",
      keyword,
      snapshotTs,
      availabilitySignal: inferredAvailability.signal,
      availabilityConfidence: inferredAvailability.confidence,
      telemetrySignals: ["parsed"],
      raw: {
        provider: "temu-search",
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

async function fetchTemuSearchText(searchUrl: string): Promise<{ text: string; mode: string }> {
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
    if (res.ok && text.length > 500) {
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
    throw new Error(`Temu read-through fetch failed: ${res.status}`);
  }
  return { text: await res.text(), mode: "read-through" };
}

async function fetchTemuReadThroughText(searchUrl: string): Promise<string> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const proxyUrl = `https://r.jina.ai/http://${searchUrl.replace(/^https?:\/\//, "")}`;
  const res = await fetch(proxyUrl, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new Error(`Temu read-through fetch failed: ${res.status}`);
  }
  return await res.text();
}

export async function searchTemuByKeyword(
  keyword: string,
  limit = 20
): Promise<SupplierProduct[]> {
  const capped = Math.min(Math.max(limit, 1), MAX_RESULTS);
  const snapshotTs = new Date().toISOString();
  const normalizedKeyword = String(keyword ?? "").trim();
  if (!normalizedKeyword) return [];
  const searchUrl = buildTemuSearchUrl(normalizedKeyword);
  const fallbackRaw: Record<string, unknown> = {
    mode: "stub-fallback",
    parseMode: "fallback",
    provider: "temu-search",
    keyword: normalizedKeyword,
    platform: "Temu",
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
    let fetched = await fetchTemuSearchText(searchUrl);
    let challengePage = looksLikeTemuChallengePage(fetched.text);
    let challengeHint = extractTemuChallengeHint(fetched.text);
    let rows = parseTemuText(fetched.text, normalizedKeyword, snapshotTs)
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

    // Retry through the read-through proxy when the direct page is a challenge
    // or when direct HTML is present but still yields zero parsable products.
    if (fetched.mode === "direct" && (challengePage || rows.length === 0)) {
      fetched = { text: await fetchTemuReadThroughText(searchUrl), mode: "read-through" };
      challengePage = looksLikeTemuChallengePage(fetched.text);
      challengeHint = extractTemuChallengeHint(fetched.text);
      rows = parseTemuText(fetched.text, normalizedKeyword, snapshotTs)
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
    }

    fallbackRaw.fetchMode = fetched.mode;
    fallbackRaw.pageChallengeDetected = challengePage;
    fallbackRaw.challengeHint = challengeHint;
    fallbackRaw.pageTextSample = challengeHint ? sliceEvidence(challengeHint) : null;
    fallbackRaw.crawlStatus = challengePage ? "CHALLENGE_PAGE" : "NO_PRODUCTS_PARSED";
    fallbackRaw.telemetrySignals = challengePage
      ? ["fallback", "challenge", "low_quality"]
      : ["fallback", "low_quality"];

    if (rows.length) {
      console.log(`[supplier][Temu] keyword="${normalizedKeyword}" fetchMode=${fetched.mode} results=${rows.length}`);
      return rows;
    }
  } catch (error) {
    fallbackRaw.crawlStatus = "FETCH_FAILED";
    fallbackRaw.fetchError = error instanceof Error ? error.message : String(error);
    console.error(`[supplier][Temu] keyword="${normalizedKeyword}" failed`, {
      error: error instanceof Error ? error.message : String(error),
      searchUrl,
    });
  }

  // Fail-safe fallback keeps discovery path active when upstream parsing is sparse.
  const fallbackRows: SupplierProduct[] = [
    {
      title: `${normalizedKeyword} sample from Temu`,
      price: "7.45",
      currency: "USD",
      images: [],
      variants: [],
      sourceUrl: searchUrl,
      supplierProductId: `temu-${normalizedKeyword.toLowerCase().replace(/\s+/g, "-")}-1`,
      shippingEstimates: [],
      platform: "Temu",
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
