import {
  CJ_ACCESS_TOKEN_REFRESH_WINDOW_MS,
  CJ_API_BASE_URL,
  CJ_DEFAULT_ACCESS_TOKEN_TTL_MS,
  CJ_DEFAULT_REFRESH_TOKEN_TTL_MS,
  type CjAccessTokenState,
  type CjAuthResponse,
  type CjWrappedResponse,
} from "./types";
import { buildCjError, CjError, isCjRefreshFailure, isCjWrappedSuccess } from "./errors";

const AUTH_MIN_INTERVAL_MS = 1_100;
const AUTH_RETRY_DELAYS_MS = [1_200, 2_500] as const;

let currentTokenState: CjAccessTokenState | null = null;
let tokenPromise: Promise<string | null> | null = null;
let authRequestQueue: Promise<void> = Promise.resolve();
let lastAuthRequestAtMs = 0;
let lastTokenRefreshAtMs = 0;

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCjTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? (parsed > 1e12 ? parsed : parsed * 1000) : null;
  }
  const parsed = Date.parse(raw.replace(/\//g, "-").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAccessTokenState(payload: CjAuthResponse, source: "access" | "refresh"): CjAccessTokenState {
  const now = Date.now();
  const accessToken = cleanString(payload.accessToken) ?? cleanString(payload.access_token);
  if (!accessToken) throw new Error("CJ auth missing access token");

  return {
    accessToken,
    accessTokenExpiresAtMs:
      parseCjTimestamp(payload.accessTokenExpiredAt) ??
      parseCjTimestamp(payload.accessTokenExpiryDate) ??
      parseCjTimestamp(payload.accessTokenExpiresAt) ??
      now + CJ_DEFAULT_ACCESS_TOKEN_TTL_MS,
    refreshToken: cleanString(payload.refreshToken) ?? cleanString(payload.refresh_token),
    refreshTokenExpiresAtMs:
      parseCjTimestamp(payload.refreshTokenExpiredAt) ??
      parseCjTimestamp(payload.refreshTokenExpiryDate) ??
      parseCjTimestamp(payload.refreshTokenExpiresAt) ??
      (cleanString(payload.refreshToken) || cleanString(payload.refresh_token)
        ? now + CJ_DEFAULT_REFRESH_TOKEN_TTL_MS
        : null),
    createdAtMs:
      parseCjTimestamp(payload.accessTokenCreateDate) ??
      parseCjTimestamp(payload.refreshTokenCreateDate) ??
      now,
    source,
  };
}

function hasUsableToken(state: CjAccessTokenState | null, now = Date.now()): state is CjAccessTokenState {
  return Boolean(state && state.accessTokenExpiresAtMs > now + CJ_ACCESS_TOKEN_REFRESH_WINDOW_MS);
}

function getApiKey(): string | null {
  return cleanString(process.env.CJ_API_KEY);
}

function getPlatformToken(): string | null {
  return cleanString(process.env.CJ_PLATFORM_TOKEN);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireAuthRequestSlot(): Promise<void> {
  const previous = authRequestQueue;
  let release = () => {};
  authRequestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const waitMs = Math.max(0, AUTH_MIN_INTERVAL_MS - (Date.now() - lastAuthRequestAtMs));
  if (waitMs > 0) await sleep(waitMs);
  lastAuthRequestAtMs = Date.now();
  release();
}

function shouldRetryAuthError(error: unknown): boolean {
  return error instanceof CjError && (error.category === "RATE_LIMITED" || error.category === "UPSTREAM_DOWN");
}

async function requestAuth(mode: "getAccessToken" | "refreshAccessToken", payload: Record<string, string>) {
  for (let attempt = 0; attempt <= AUTH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await acquireAuthRequestSlot();
      const response = await fetch(`${CJ_API_BASE_URL}/authentication/${mode}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const wrapped = (await response.json().catch(() => ({}))) as CjWrappedResponse<CjAuthResponse>;
      if (!response.ok || !isCjWrappedSuccess(wrapped)) {
        throw buildCjError({
          operation: `cj.${mode}`,
          status: response.status,
          wrapped,
        });
      }
      return buildAccessTokenState(wrapped.data ?? {}, mode === "getAccessToken" ? "access" : "refresh");
    } catch (error) {
      const retryDelayMs = AUTH_RETRY_DELAYS_MS[attempt];
      if (!shouldRetryAuthError(error) || retryDelayMs == null) throw error;
      await sleep(retryDelayMs);
    }
  }
  throw new Error(`CJ auth retry budget exhausted for ${mode}`);
}

async function requestFreshAccessToken(apiKey: string): Promise<string> {
  currentTokenState = await requestAuth("getAccessToken", { apiKey });
  lastTokenRefreshAtMs = Date.now();
  return currentTokenState.accessToken;
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  currentTokenState = await requestAuth("refreshAccessToken", { refreshToken });
  lastTokenRefreshAtMs = Date.now();
  return currentTokenState.accessToken;
}

function toIsoOrNull(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

async function getTokenUnlocked(): Promise<string | null> {
  const now = Date.now();
  const currentState = currentTokenState;
  if (
    currentState &&
    currentState.accessTokenExpiresAtMs > now + CJ_ACCESS_TOKEN_REFRESH_WINDOW_MS
  ) {
    return currentState.accessToken;
  }

  if (
    currentState &&
    currentState.refreshToken &&
    currentState.refreshTokenExpiresAtMs != null &&
    currentState.refreshTokenExpiresAtMs > now + 60_000
  ) {
    try {
      return await refreshAccessToken(currentState.refreshToken);
    } catch (error) {
      const apiKey = getApiKey();
      if (!(error instanceof CjError) || !isCjRefreshFailure(error.code) || !apiKey) throw error;
      currentTokenState = null;
      return requestFreshAccessToken(apiKey);
    }
  }

  const apiKey = getApiKey();
  if (!apiKey) return null;
  return requestFreshAccessToken(apiKey);
}

function withTokenLock(factory: () => Promise<string | null>): Promise<string | null> {
  if (tokenPromise) return tokenPromise;
  tokenPromise = factory().finally(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}

export async function getValidCjAccessToken(): Promise<string | null> {
  return withTokenLock(() => getTokenUnlocked());
}

export function invalidateCjAccessToken(): void {
  if (!currentTokenState) return;
  currentTokenState = {
    ...currentTokenState,
    accessTokenExpiresAtMs: 0,
  };
}

export function getCjAuthSnapshot() {
  const now = Date.now();
  return {
    hasApiKey: Boolean(getApiKey()),
    hasPlatformToken: Boolean(getPlatformToken()),
    tokenFresh: hasUsableToken(currentTokenState, now),
    accessTokenExpiresAtMs: currentTokenState?.accessTokenExpiresAtMs ?? null,
    refreshTokenExpiresAtMs: currentTokenState?.refreshTokenExpiresAtMs ?? null,
    tokenSource: currentTokenState?.source ?? null,
    tokenCreatedAtMs: currentTokenState?.createdAtMs ?? null,
    lastTokenRefreshAtMs: lastTokenRefreshAtMs || null,
    accessTokenExpiresAt: toIsoOrNull(currentTokenState?.accessTokenExpiresAtMs ?? null),
    refreshTokenExpiresAt: toIsoOrNull(currentTokenState?.refreshTokenExpiresAtMs ?? null),
    tokenCreatedAt: toIsoOrNull(currentTokenState?.createdAtMs ?? null),
    lastTokenRefreshAt: toIsoOrNull(lastTokenRefreshAtMs || null),
  };
}

export function getConfiguredCjPlatformToken(): string {
  return getPlatformToken() ?? "";
}

export function __resetCjAuthForTests(): void {
  currentTokenState = null;
  tokenPromise = null;
  authRequestQueue = Promise.resolve();
  lastAuthRequestAtMs = 0;
  lastTokenRefreshAtMs = 0;
}
