type FetchMode = "direct" | "read-through" | "provider-proxy" | "zenrows" | "scrapingbee";

export type SupplierPageFetchResult = {
  text: string;
  mode: FetchMode;
  status: number;
  finalUrl: string;
};

type FetchAttempt = {
  mode: FetchMode;
  url: string;
  init?: RequestInit;
};

type SupplierPageFetchInput = {
  url: string;
  accept: string;
  validate: (input: { text: string; status: number; mode: FetchMode }) => boolean;
};

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

function buildReadThroughUrl(url: string): string {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
}

function buildProviderProxyAttempt(url: string, accept: string): FetchAttempt | null {
  const template = String(process.env.SUPPLIER_FETCH_PROXY_URL ?? "").trim();
  if (!template) return null;

  const token = String(process.env.SUPPLIER_FETCH_PROXY_TOKEN ?? "").trim();
  const proxyUrl = template.includes("{url}") ? template.replaceAll("{url}", encodeURIComponent(url)) : `${template}${template.includes("?") ? "&" : "?"}url=${encodeURIComponent(url)}`;
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    Accept: accept,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  return {
    mode: "provider-proxy",
    url: proxyUrl,
    init: {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  };
}

function buildZenRowsAttempt(url: string): FetchAttempt | null {
  const apiKey = String(process.env.ZENROWS_API_KEY ?? "").trim();
  if (!apiKey) return null;

  const zenUrl = new URL("https://api.zenrows.com/v1/");
  zenUrl.searchParams.set("apikey", apiKey);
  zenUrl.searchParams.set("url", url);
  zenUrl.searchParams.set("js_render", "true");
  zenUrl.searchParams.set("premium_proxy", "true");
  zenUrl.searchParams.set("wait", "1500");

  return {
    mode: "zenrows",
    url: zenUrl.toString(),
    init: {
      method: "GET",
      headers: {
        ...DEFAULT_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
    },
  };
}

function buildScrapingBeeAttempt(url: string): FetchAttempt | null {
  const apiKey = String(process.env.SCRAPINGBEE_API_KEY ?? "").trim();
  if (!apiKey) return null;

  const beeUrl = new URL("https://app.scrapingbee.com/api/v1/");
  beeUrl.searchParams.set("api_key", apiKey);
  beeUrl.searchParams.set("url", url);
  beeUrl.searchParams.set("render_js", "true");
  beeUrl.searchParams.set("premium_proxy", "true");
  beeUrl.searchParams.set("wait", "1500");

  return {
    mode: "scrapingbee",
    url: beeUrl.toString(),
    init: {
      method: "GET",
      headers: {
        ...DEFAULT_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
    },
  };
}

export async function fetchSupplierPageWithFallback(
  input: SupplierPageFetchInput
): Promise<SupplierPageFetchResult> {
  const { url, accept, validate } = input;
  const attempts: FetchAttempt[] = [
    {
      mode: "direct",
      url,
      init: {
        method: "GET",
        headers: {
          ...DEFAULT_HEADERS,
          Accept: accept,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    },
    {
      mode: "read-through",
      url: buildReadThroughUrl(url),
      init: {
        method: "GET",
        headers: {
          ...DEFAULT_HEADERS,
          Accept: accept,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      },
    },
  ];

  const providerProxy = buildProviderProxyAttempt(url, accept);
  if (providerProxy) attempts.push(providerProxy);
  const zenrows = buildZenRowsAttempt(url);
  if (zenrows) attempts.push(zenrows);
  const scrapingBee = buildScrapingBeeAttempt(url);
  if (scrapingBee) attempts.push(scrapingBee);

  let lastResult: SupplierPageFetchResult | null = null;
  let lastError: Error | null = null;

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, attempt.init);
      const text = await res.text();
      const result: SupplierPageFetchResult = {
        text,
        mode: attempt.mode,
        status: res.status,
        finalUrl: attempt.url,
      };
      lastResult = result;

      if (res.ok && validate({ text, status: res.status, mode: attempt.mode })) {
        return result;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastResult) return lastResult;
  throw lastError ?? new Error(`Supplier page fetch failed for ${url}`);
}
