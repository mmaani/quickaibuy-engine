import { getConfiguredCjPlatformToken, getValidCjAccessToken, invalidateCjAccessToken } from "./auth";
import { buildCjError, CjError, isCjAuthFailure, isCjRefreshFailure, isCjWrappedSuccess } from "./errors";
import { CJ_API_BASE_URL, type CjRequestOptions, type CjWrappedResponse } from "./types";

const LOW_TIER_DEFAULT_QPS = 1;
const MIN_INTERVAL_MS = Math.ceil(1000 / LOW_TIER_DEFAULT_QPS);
const REQUEST_RETRY_DELAYS_MS = [1_200, 2_500] as const;
const requestCache = new Map<string, { expiresAt: number; value: unknown }>();
let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAtMs = 0;

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(input: Pick<CjRequestOptions, "path" | "query">): string {
  const url = new URL(`${CJ_API_BASE_URL}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    const cleaned = typeof value === "string" ? cleanString(value) : value;
    if (cleaned == null || cleaned === false) continue;
    url.searchParams.set(key, String(cleaned));
  }
  return url.toString();
}

function getCached<T>(key: string): T | null {
  const current = requestCache.get(key);
  if (!current) return null;
  if (current.expiresAt <= Date.now()) {
    requestCache.delete(key);
    return null;
  }
  return current.value as T;
}

function setCached(key: string, value: unknown, ttlMs: number): void {
  requestCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function acquireRequestSlot(): Promise<void> {
  const previous = requestQueue;
  let release = () => {};
  requestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const waitMs = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAtMs));
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAtMs = Date.now();
  release();
}

function shouldRetryRequestError(error: unknown): boolean {
  return error instanceof CjError && (error.category === "RATE_LIMITED" || error.category === "UPSTREAM_DOWN");
}

async function execute<T>(input: CjRequestOptions, accessToken: string): Promise<CjWrappedResponse<T>> {
  for (let attempt = 0; attempt <= REQUEST_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await acquireRequestSlot();
      const response = await fetch(buildUrl(input), {
        method: input.method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "CJ-Access-Token": accessToken,
          platformToken: input.includePlatformToken ? getConfiguredCjPlatformToken(accessToken) : "",
        },
        body: input.body == null ? undefined : JSON.stringify(input.body),
        cache: "no-store",
      });
      const wrapped = (await response.json().catch(() => ({}))) as CjWrappedResponse<T>;
      if (!response.ok || !isCjWrappedSuccess(wrapped)) {
        throw buildCjError({
          operation: input.operation,
          status: response.status,
          wrapped,
          details: { path: input.path, query: input.query ?? null },
        });
      }
      return wrapped;
    } catch (error) {
      const retryDelayMs = REQUEST_RETRY_DELAYS_MS[attempt];
      if (!shouldRetryRequestError(error) || retryDelayMs == null) throw error;
      await sleep(retryDelayMs);
    }
  }
  throw new Error(`CJ request retry budget exhausted for ${input.operation}`);
}

export async function cjRequest<T>(input: CjRequestOptions): Promise<CjWrappedResponse<T> | null> {
  const cacheKey =
    input.cacheTtlMs && input.method === "GET"
      ? `${input.path}:${JSON.stringify(input.query ?? {})}`
      : null;
  if (cacheKey && input.cacheTtlMs) {
    const cached = getCached<CjWrappedResponse<T>>(cacheKey);
    if (cached) return cached;
  }

  const accessToken = await getValidCjAccessToken();
  if (!accessToken) {
    if (input.allowMissingAuth) return null;
    throw new Error("CJ auth unavailable: missing CJ_API_KEY");
  }

  try {
    const wrapped = await execute<T>(input, accessToken);
    if (cacheKey && input.cacheTtlMs) setCached(cacheKey, wrapped, input.cacheTtlMs);
    return wrapped;
  } catch (error) {
    if (!(error instanceof CjError)) throw error;
    if (!isCjAuthFailure(error.status, error.code) && !isCjRefreshFailure(error.code)) throw error;
    invalidateCjAccessToken();
    const refreshed = await getValidCjAccessToken();
    if (!refreshed) throw error;
    const wrapped = await execute<T>(input, refreshed);
    if (cacheKey && input.cacheTtlMs) setCached(cacheKey, wrapped, input.cacheTtlMs);
    return wrapped;
  }
}

export function __resetCjClientForTests(): void {
  requestCache.clear();
  requestQueue = Promise.resolve();
  lastRequestAtMs = 0;
}
