const CJ_API_BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1";

type CjAccessTokenState = {
  token: string;
  expiresAtMs: number;
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

let cjAccessTokenState: CjAccessTokenState | null = null;

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function getCjAccessToken(): Promise<string> {
  const now = Date.now();
  if (cjAccessTokenState && cjAccessTokenState.expiresAtMs > now + 60_000) {
    return cjAccessTokenState.token;
  }

  const apiKey = cleanString(process.env.CJ_API_KEY);
  if (!apiKey) {
    throw new Error("Missing CJ_API_KEY");
  }

  const response = await fetch(`${CJ_API_BASE_URL}/authentication/getAccessToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ apiKey }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as CjWrappedResponse<CjAuthResponse>;
  const token = cleanString(payload.data?.accessToken) ?? cleanString(payload.data?.access_token);

  if (!response.ok || !token) {
    throw new Error(`CJ authentication failed: ${response.status} ${payload.message ?? "unknown error"}`);
  }

  cjAccessTokenState = {
    token,
    expiresAtMs: now + 60 * 60 * 1000,
  };

  return token;
}

async function cjRequest<T>(input: {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | null | undefined>;
  body?: unknown;
}): Promise<CjWrappedResponse<T>> {
  const token = await getCjAccessToken();
  const url = new URL(`${CJ_API_BASE_URL}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    const cleaned = cleanString(value);
    if (cleaned) {
      url.searchParams.set(key, cleaned);
    }
  }

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
  if (!response.ok || payload.result === false || payload.success === false) {
    throw new Error(`CJ request failed: ${response.status} ${payload.message ?? "unknown error"}`);
  }
  return payload;
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
