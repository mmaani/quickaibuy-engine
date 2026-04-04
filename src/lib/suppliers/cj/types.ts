export const CJ_API_BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1";
export const CJ_ACCESS_TOKEN_REFRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
export const CJ_DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 24 * 60 * 60 * 1000;
export const CJ_DEFAULT_REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export type CjWrappedResponse<T> = {
  code?: number;
  result?: boolean;
  success?: boolean;
  message?: string;
  data?: T;
  requestId?: string;
};

export type CjAuthResponse = {
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

export type CjAccessTokenState = {
  accessToken: string;
  accessTokenExpiresAtMs: number;
  refreshToken: string | null;
  refreshTokenExpiresAtMs: number | null;
  createdAtMs: number;
  source: "access" | "refresh";
};

export type CjErrorCategory =
  | "AUTH_INVALID"
  | "REFRESH_INVALID"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "PARAM_INVALID"
  | "ORDER_CREATE_FAILED"
  | "ORDER_DUPLICATE"
  | "INVENTORY_FAILED"
  | "LOGISTIC_INVALID"
  | "WEBHOOK_INVALID"
  | "UPSTREAM_UNAVAILABLE"
  | "UNKNOWN";

export type CjRequestOptions = {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  allowMissingAuth?: boolean;
  includePlatformToken?: boolean;
  cacheTtlMs?: number;
  operation: string;
};

export type CjSettingsPayload = {
  apiStatus?: string | number | boolean;
  apiLevel?: string | number;
  userLevel?: string | number;
  salesLevel?: string | number;
  qps?: number | string;
  apiQps?: number | string;
  limitQps?: number | string;
  quota?: number | string;
  dayQuota?: number | string;
  monthQuota?: number | string;
  usedQuota?: number | string;
  remainingQuota?: number | string;
  sandbox?: boolean | string | number;
  isSandbox?: boolean | string | number;
  environment?: string;
  authStatus?: string;
  verifiedWarehouse?: number | string;
  [key: string]: unknown;
};

export type CjSettingsSummary = {
  raw: CjSettingsPayload | null;
  qpsLimit: number | null;
  quotaLimit: number | null;
  quotaRemaining: number | null;
  userLevel: string | null;
  salesLevel: string | null;
  sandbox: boolean | null;
  operationalState: "verified-like" | "unverified-like" | "unknown";
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
  cjPayUrl: string | null;
  raw: unknown;
};

export type CjOrderStatusResult = {
  orderId: string | null;
  orderNum: string | null;
  cjOrderId: string | null;
  orderStatus: string | null;
  logisticName: string | null;
  fromCountryCode: string | null;
  trackNumber: string | null;
  raw: unknown;
};

export type CjTrackingInfo = {
  trackingNumber: string | null;
  logisticName: string | null;
  trackingStatus: string | null;
  raw: unknown;
};
