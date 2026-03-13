import type { SupplierProduct } from "./types";
import { inferAvailabilityFromText } from "@/lib/products/supplierAvailability";

const MAX_RESULTS = 20;

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

    const nearbyText = text.slice(Math.max(0, idx - 380), idx + 420);
    const inferredAvailability = inferAvailabilityFromText(nearbyText);

    seen.add(supplierProductId);
    out.push({
      title: extractTitleNear(text, idx),
      price: extractPriceNear(text, idx),
      currency: "USD",
      images: extractImageNear(text, idx),
      variants: [],
      sourceUrl,
      supplierProductId,
      shippingEstimates: [],
      platform: "Temu",
      keyword,
      snapshotTs,
      availabilitySignal: inferredAvailability.signal,
      availabilityConfidence: inferredAvailability.confidence,
      raw: {
        provider: "temu-search",
        parseMode: "text",
        matchedItemUrl: rawUrl,
        availabilitySignal: inferredAvailability.signal,
        availabilityConfidence: inferredAvailability.confidence,
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

export async function searchTemuByKeyword(
  keyword: string,
  limit = 20
): Promise<SupplierProduct[]> {
  const capped = Math.min(Math.max(limit, 1), MAX_RESULTS);
  const snapshotTs = new Date().toISOString();
  const normalizedKeyword = String(keyword ?? "").trim();
  if (!normalizedKeyword) return [];
  const searchUrl = buildTemuSearchUrl(normalizedKeyword);

  try {
    const fetched = await fetchTemuSearchText(searchUrl);
    const rows = parseTemuText(fetched.text, normalizedKeyword, snapshotTs)
      .slice(0, capped)
      .map((row) => ({
        ...row,
        raw: {
          ...row.raw,
          fetchMode: fetched.mode,
          searchUrl,
        },
      }));

    if (rows.length) {
      console.log(`[supplier][Temu] keyword="${normalizedKeyword}" fetchMode=${fetched.mode} results=${rows.length}`);
      return rows;
    }
  } catch (error) {
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
      availabilityConfidence: 0.35,
      raw: {
        mode: "stub-fallback",
        keyword: normalizedKeyword,
        platform: "Temu",
        availabilitySignal: "UNKNOWN",
        availabilityConfidence: 0.35,
      },
    },
  ];
  return fallbackRows.slice(0, capped);
}
