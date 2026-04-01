import "server-only";

const CJ_API_BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1";

type CjAccessTokenState = {
  accessToken: string;
  accessTokenExpiresAtMs: number;
  refreshToken: string | null;
  refreshTokenExpiresAtMs: number | null;
  createdAtMs: number;
};

type CjWrappedResponse<T> = {
  code?: number;
  result?: boolean;
  success?: boolean;
  message?: string;
  data?: T;
  requestId?: string;
};

type CjAuthResponse = {
  accessToken?: string;
  access_token?: string;
  accessTokenExpiredAt?: string | number;
  accessTokenExpiryDate?: string | number;
  accessTokenExpiresAt?: string | number;
  accessTokenCreateDate?: string | number;
  refreshToken?: string;
  refresh_token?: string;
  refreshTokenExpiredAt?: string | number;
  refreshTokenExpiryDate?: string | number;
  refreshTokenExpiresAt?: string | number;
  refreshTokenCreateDate?: string | number;
};

export type CjCreateOrderInput = {
  orderNumber: string;
  shippingZip: string;
  shippingCountry: string;
  shippingCountryCode: string;
  shippingProvince: string;
  shippingCity: string;
  shippingCounty?: string | null;
  shippingPhone: string;
  shippingCustomerName: string;
  shippingAddress: string;
  shippingAddress2?: string | null;
  email?: string | null;
  remark?: string | null;
  logisticName?: string | null;
  fromCountryCode?: string | null;
  platform?: string | null;
  products: Array<{
    sku?: string | null;
    vid?: string | null;
    quantity: number;
    storeLineItemId?: string | null;
  }>;
};

export type CjCreateOrderResult = {
  orderId: string | null;
  orderNum: string | null;
  cjOrderId: string | null;
  orderStatus: string | null;
  logisticName: string | null;
  raw: unknown;
};

export type CjOrderStatusResult = {
  orderId: string | null;
  cjOrderId: string | null;
  orderStatus: string | null;
  logisticName: string | null;
  trackNumber: string | null;
  raw: unknown;
};

const CJ_ACCESS_TOKEN_REFRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
const CJ_DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 24 * 60 * 60 * 1000;
const CJ_DEFAULT_REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;
let cjAccessTokenState: CjAccessTokenState | null = null;
let cjAccessTokenPromise: Promise<string> | null = null;

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCjTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const normalized = raw.replace(/\//g, "-").replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCjWrappedSuccess<T>(wrapped: CjWrappedResponse<T>): boolean {
  if (wrapped.success === false || wrapped.result === false) return false;
  if (typeof wrapped.code === "number") {
    return wrapped.code === 200 || wrapped.code === 0;
  }
  return true;
}

function isCjAuthFailureResponse(response: Response, wrapped: CjWrappedResponse<unknown>): boolean {
  if (response.status === 401 || response.status === 403) return true;
  const message = String(wrapped.message ?? "").toLowerCase();
  const code = typeof wrapped.code === "number" ? wrapped.code : null;
  if (code != null && [401, 403, 1002, 1003, 1102].includes(code)) return true;
  return message.includes("token") && (message.includes("invalid") || message.includes("expired") || message.includes("auth"));
}

function buildCjApiError(prefix: string, response: Response, wrapped: CjWrappedResponse<unknown>): Error {
  return new Error(`${prefix}: ${response.status} ${wrapped.message ?? "unknown error"}`);
}

function buildCjAccessTokenState(payload: CjAuthResponse, now: number): CjAccessTokenState {
  const accessToken = cleanString(payload.accessToken) ?? cleanString(payload.access_token);
  if (!accessToken) {
    throw new Error("CJ auth missing access token");
  }

  const accessTokenExpiresAtMs =
    parseCjTimestamp(payload.accessTokenExpiredAt) ??
    parseCjTimestamp(payload.accessTokenExpiryDate) ??
    parseCjTimestamp(payload.accessTokenExpiresAt) ??
    now + CJ_DEFAULT_ACCESS_TOKEN_TTL_MS;
  const refreshToken = cleanString(payload.refreshToken) ?? cleanString(payload.refresh_token);
  const refreshTokenExpiresAtMs = refreshToken
    ? parseCjTimestamp(payload.refreshTokenExpiredAt) ??
      parseCjTimestamp(payload.refreshTokenExpiryDate) ??
      parseCjTimestamp(payload.refreshTokenExpiresAt) ??
      now + CJ_DEFAULT_REFRESH_TOKEN_TTL_MS
    : null;
  const createdAtMs =
    parseCjTimestamp(payload.accessTokenCreateDate) ??
    parseCjTimestamp(payload.refreshTokenCreateDate) ??
    now;

  return {
    accessToken,
    accessTokenExpiresAtMs,
    refreshToken,
    refreshTokenExpiresAtMs,
    createdAtMs,
  };
}

function hasUsableCjAccessToken(state: CjAccessTokenState | null, now = Date.now()): state is CjAccessTokenState {
  return Boolean(state && state.accessTokenExpiresAtMs > now + CJ_ACCESS_TOKEN_REFRESH_WINDOW_MS);
}

function hasRefreshableCjToken(state: CjAccessTokenState | null, now = Date.now()): state is CjAccessTokenState {
  return Boolean(
    state &&
      state.refreshToken &&
      state.refreshTokenExpiresAtMs &&
      state.refreshTokenExpiresAtMs > now + 60_000
  );
}

function invalidateCurrentCjAccessToken(): void {
  if (!cjAccessTokenState) return;
  cjAccessTokenState = {
    ...cjAccessTokenState,
    accessTokenExpiresAtMs: 0,
  };
}

async function requestCjAuthState(
  mode: "getAccessToken" | "refreshAccessToken",
  payload: Record<string, string>,
): Promise<CjAccessTokenState> {
  const now = Date.now();
  const response = await fetch(`${CJ_API_BASE_URL}/authentication/${mode}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const wrapped = (await response.json().catch(() => ({}))) as CjWrappedResponse<CjAuthResponse>;
  if (!response.ok || !isCjWrappedSuccess(wrapped)) {
    throw buildCjApiError(`CJ ${mode} failed`, response, wrapped);
  }

  return buildCjAccessTokenState(wrapped.data ?? {}, now);
}

async function withCjAccessTokenLock(factory: () => Promise<string>): Promise<string> {
  if (cjAccessTokenPromise) {
    return cjAccessTokenPromise;
  }

  cjAccessTokenPromise = factory().finally(() => {
    cjAccessTokenPromise = null;
  });

  return cjAccessTokenPromise;
}

async function getCjAccessTokenUnlocked(): Promise<string> {
  const now = Date.now();
  if (hasUsableCjAccessToken(cjAccessTokenState, now)) {
    return cjAccessTokenState.accessToken;
  }

  const apiKey = cleanString(process.env.CJ_API_KEY);
  if (!apiKey) {
    throw new Error("Missing CJ_API_KEY");
  }

  if (hasRefreshableCjToken(cjAccessTokenState, now)) {
    return refreshCjAccessTokenUnlocked();
  }

  cjAccessTokenState = await requestCjAuthState("getAccessToken", { apiKey });
  return cjAccessTokenState.accessToken;
}

async function refreshCjAccessTokenUnlocked(): Promise<string> {
  const now = Date.now();
  const currentState = cjAccessTokenState;
  if (hasUsableCjAccessToken(currentState, now)) {
    return currentState.accessToken;
  }

  if (!hasRefreshableCjToken(currentState, now)) {
    return getCjAccessTokenUnlocked();
  }

  const refreshToken = (currentState as CjAccessTokenState).refreshToken;
  if (!refreshToken) {
    return getCjAccessTokenUnlocked();
  }

  cjAccessTokenState = await requestCjAuthState("refreshAccessToken", { refreshToken });
  return cjAccessTokenState.accessToken;
}

async function refreshCjAccessToken(): Promise<string> {
  return withCjAccessTokenLock(() => refreshCjAccessTokenUnlocked());
}

async function getValidCjAccessToken(): Promise<string> {
  return withCjAccessTokenLock(async () => {
    const now = Date.now();
    if (hasUsableCjAccessToken(cjAccessTokenState, now)) {
      return cjAccessTokenState.accessToken;
    }

    if (hasRefreshableCjToken(cjAccessTokenState, now)) {
      return refreshCjAccessTokenUnlocked();
    }

    return getCjAccessTokenUnlocked();
  });
}

async function cjRequest<T>(input: {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | null | undefined>;
  body?: unknown;
}): Promise<CjWrappedResponse<T>> {
  const url = new URL(`${CJ_API_BASE_URL}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    const cleaned = cleanString(value);
    if (cleaned) {
      url.searchParams.set(key, cleaned);
    }
  }

  const execute = async (token: string) => {
    const response = await fetch(url.toString(), {
      method: input.method,
      headers: {
        "CJ-Access-Token": token,
        platformToken: "",
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      body: input.body == null ? undefined : JSON.stringify(input.body),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as CjWrappedResponse<T>;
    return { response, payload };
  };

  let result = await execute(await getValidCjAccessToken());
  if (!result.response.ok || !isCjWrappedSuccess(result.payload)) {
    if (!isCjAuthFailureResponse(result.response, result.payload)) {
      throw buildCjApiError("CJ request failed", result.response, result.payload);
    }

    invalidateCurrentCjAccessToken();
    result = await execute(await refreshCjAccessToken());
    if (!result.response.ok || !isCjWrappedSuccess(result.payload)) {
      throw buildCjApiError("CJ request failed", result.response, result.payload);
    }
  }

  return result.payload;
}

export async function createOrder(input: CjCreateOrderInput): Promise<CjCreateOrderResult> {
  const payload = await cjRequest<Record<string, unknown>>({
    method: "POST",
    path: "/shopping/order/createOrderV3",
    body: {
      orderNumber: input.orderNumber,
      shippingZip: input.shippingZip,
      shippingCountry: input.shippingCountry,
      shippingCountryCode: input.shippingCountryCode,
      shippingProvince: input.shippingProvince,
      shippingCity: input.shippingCity,
      shippingCounty: input.shippingCounty ?? "",
      shippingPhone: input.shippingPhone,
      shippingCustomerName: input.shippingCustomerName,
      shippingAddress: input.shippingAddress,
      shippingAddress2: input.shippingAddress2 ?? "",
      email: input.email ?? "",
      remark: input.remark ?? "",
      logisticName: input.logisticName ?? "",
      fromCountryCode: input.fromCountryCode ?? "",
      platform: cleanString(input.platform) ?? "ebay",
      products: input.products.map((product) => ({
        sku: cleanString(product.sku) ?? undefined,
        vid: cleanString(product.vid) ?? undefined,
        quantity: product.quantity,
        storeLineItemId: cleanString(product.storeLineItemId) ?? undefined,
      })),
    },
  });

  const data = (payload.data ?? {}) as Record<string, unknown>;
  return {
    orderId: cleanString(data.orderId),
    orderNum: cleanString(data.orderNum) ?? cleanString(data.orderNumber),
    cjOrderId: cleanString(data.cjOrderId),
    orderStatus: cleanString(data.orderStatus),
    logisticName: cleanString(data.logisticName),
    raw: payload.data ?? null,
  };
}

export async function getOrderStatus(orderId: string): Promise<CjOrderStatusResult> {
  const payload = await cjRequest<Record<string, unknown>>({
    method: "GET",
    path: "/shopping/order/getOrderDetail",
    query: {
      orderId,
      features: "LOGISTICS_TIMELINESS",
    },
  });

  const data = (payload.data ?? {}) as Record<string, unknown>;
  return {
    orderId: cleanString(data.orderId),
    cjOrderId: cleanString(data.cjOrderId),
    orderStatus: cleanString(data.orderStatus),
    logisticName: cleanString(data.logisticName),
    trackNumber: cleanString(data.trackNumber),
    raw: payload.data ?? null,
  };
}
