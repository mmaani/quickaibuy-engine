import type { SupplierProduct } from "./types";

const MAX_RESULTS = 20;

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

    const title = extractTitleNear(text, idx);
    const price = extractPriceFromItemUrl(rawUrl) ?? extractPriceNear(text, idx);
    const images = extractImageNear(text, idx);
    const sourceUrl = normalizeAliExpressItemUrl(rawUrl, itemId);

    seen.add(itemId);

    out.push({
      title,
      price,
      currency: "USD",
      images,
      variants: [],
      sourceUrl,
      supplierProductId: itemId,
      shippingEstimates: [],
      platform: "AliExpress",
      keyword,
      snapshotTs,
      raw: {
        provider: "aliexpress-search",
        parseMode: "text",
        matchedItemUrl: rawUrl,
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

  try {
    const fetched = await fetchAliExpressSearchText(searchUrl);
    const rows = parseAliExpressText(fetched.text, normalizedKeyword, snapshotTs)
      .filter((row) => row.title || row.supplierProductId)
      .slice(0, capped)
      .map((row) => ({
        ...row,
        raw: {
          ...row.raw,
          fetchMode: fetched.mode,
          searchUrl,
        },
      }));

    console.log(
      `[supplier][AliExpress] keyword="${normalizedKeyword}" fetchMode=${fetched.mode} results=${rows.length}`
    );

    return rows;
  } catch (error) {
    console.error(`[supplier][AliExpress] keyword="${normalizedKeyword}" failed`, {
      error: error instanceof Error ? error.message : String(error),
      searchUrl,
    });
    return [];
  }
}
