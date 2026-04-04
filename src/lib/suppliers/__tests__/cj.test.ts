import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetCjAuthForTests,
  __resetCjClientForTests,
  CJ_CANONICAL_CREATE_ORDER_ENDPOINT,
  CJ_DEPRECATED_RUNTIME_ENDPOINTS,
  CJ_DOCUMENTED_CREATE_ORDER_ENDPOINTS,
  CJ_PRIMARY_RUNTIME_ENDPOINTS,
  cjRequest,
  CjError,
  createCjOrder,
  getCjProofRiskFlags,
  getCjProofStateSummary,
  getCjRuntimeDiagnostics,
  readCjProofStateFromRawPayload,
  extractTrackingCarrier,
  extractTrackingNumber,
  getCjOrderDetail,
  mapCjOrderStatusToPurchaseStatus,
} from "@/lib/suppliers/cj";
import { classifyRuntimeFailure } from "@/lib/operations/runtimeFailure";

const originalFetch = global.fetch;
const originalApiKey = process.env.CJ_API_KEY;
const originalPlatformToken = process.env.CJ_PLATFORM_TOKEN;

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey == null) delete process.env.CJ_API_KEY;
  else process.env.CJ_API_KEY = originalApiKey;
  if (originalPlatformToken == null) delete process.env.CJ_PLATFORM_TOKEN;
  else process.env.CJ_PLATFORM_TOKEN = originalPlatformToken;
  __resetCjAuthForTests();
  __resetCjClientForTests();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("cjRequest refreshes after invalid access token once", async () => {
  process.env.CJ_API_KEY = "test-key";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    if (url.includes("/authentication/getAccessToken")) {
      return jsonResponse({
        code: 200,
        result: true,
        data: {
          accessToken: "token-1",
          refreshToken: "refresh-1",
          accessTokenExpiresAt: Date.now() + 10 * 60 * 60 * 1000,
          refreshTokenExpiresAt: Date.now() + 5 * 60 * 1000,
        },
      });
    }
    if (url.includes("/authentication/refreshAccessToken")) {
      return jsonResponse({
        code: 200,
        result: true,
        data: {
          accessToken: "token-2",
          refreshToken: "refresh-2",
          accessTokenExpiresAt: Date.now() + 10 * 60 * 60 * 1000,
          refreshTokenExpiresAt: Date.now() + 120_000,
        },
      });
    }
    const token = (init?.headers as Record<string, string>)?.["CJ-Access-Token"];
    if (token === "token-1") {
      return jsonResponse({ code: 1600001, result: false, message: "invalid access token" });
    }
    return jsonResponse({ code: 200, result: true, data: { ok: true } });
  }) as typeof fetch;

  const wrapped = await cjRequest<{ ok: boolean }>({
    method: "GET",
    path: "/setting/get",
    operation: "cj.test.refresh",
  });

  assert.equal(wrapped?.data?.ok, true);
  assert.ok(calls.some((call) => call.url.includes("/authentication/refreshAccessToken")));
});

test("cjRequest falls back to getAccessToken when refresh token is invalid", async () => {
  process.env.CJ_API_KEY = "test-key";
  let accessTokenCalls = 0;
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/authentication/getAccessToken")) {
      accessTokenCalls += 1;
      return jsonResponse({
        code: 200,
        result: true,
        data: {
          accessToken: accessTokenCalls === 1 ? "token-1" : "token-2",
          refreshToken: accessTokenCalls === 1 ? "refresh-1" : "refresh-2",
          accessTokenExpiresAt: Date.now() + 10 * 60 * 60 * 1000,
          refreshTokenExpiresAt: Date.now() + 5 * 60 * 1000,
        },
      });
    }
    if (url.includes("/authentication/refreshAccessToken")) {
      return jsonResponse({ code: 1600003, result: false, message: "invalid refresh token" });
    }
    const token = (init?.headers as Record<string, string>)?.["CJ-Access-Token"];
    if (token === "token-1") {
      return jsonResponse({ code: 1600001, result: false, message: "invalid access token" });
    }
    return jsonResponse({ code: 200, result: true, data: { ok: true } });
  }) as typeof fetch;

  const wrapped = await cjRequest<{ ok: boolean }>({ method: "GET", path: "/setting/get", operation: "cj.test.invalid-refresh" });
  assert.equal(wrapped?.data?.ok, true);
  assert.equal(accessTokenCalls, 2);
});

test("cjRequest uses access token as platformToken fallback when env token is unset", async () => {
  process.env.CJ_API_KEY = "test-key";
  delete process.env.CJ_PLATFORM_TOKEN;

  let observedPlatformToken = null;
  let observedAccessToken = null;

  global.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/authentication/getAccessToken")) {
      return jsonResponse({
        code: 200,
        result: true,
        data: {
          accessToken: "token-1",
          refreshToken: "refresh-1",
          accessTokenExpiresAt: Date.now() + 10 * 60 * 60 * 1000,
          refreshTokenExpiresAt: Date.now() + 120_000,
        },
      });
    }

    const headers = (init?.headers ?? {}) as Record<string, string>;
    observedAccessToken = headers["CJ-Access-Token"] ?? null;
    observedPlatformToken = headers.platformToken ?? null;

    return jsonResponse({
      code: 200,
      result: true,
      data: { orderId: "CJ-1" },
    });
  });

  const result = await createCjOrder({
    orderNumber: "CJ-PROOF-1",
    shippingZip: "08817",
    shippingCountry: "United States",
    shippingCountryCode: "US",
    shippingProvince: "New Jersey",
    shippingCity: "Edison",
    shippingPhone: "+15712654718",
    shippingCustomerName: "QuickAIBuy Internal Proof",
    shippingAddress: "63 DULEY Ave INTERNAL PROOF",
    logisticName: "YunExpress Sensitive",
    fromCountryCode: "CN",
    products: [{ vid: "1681189962735165440", quantity: 1 }],
  });

  assert.equal(result.orderId, "CJ-1");
  assert.equal(observedAccessToken, "token-1");
  assert.equal(observedPlatformToken, "token-1");
});

test("cjRequest retries rate limit once and succeeds", async () => {
  process.env.CJ_API_KEY = "test-key";
  let attempt = 0;
  global.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/authentication/getAccessToken")) {
      return jsonResponse({
        code: 200,
        result: true,
        data: {
          accessToken: "token-1",
          refreshToken: "refresh-1",
          accessTokenExpiresAt: Date.now() + 10 * 60 * 60 * 1000,
          refreshTokenExpiresAt: Date.now() + 120_000,
        },
      });
    }
    attempt += 1;
    if (attempt === 1) {
      return jsonResponse({ code: 1600200, result: false, message: "rate limited" }, 429);
    }
    return jsonResponse({ code: 200, result: true, data: { ok: true } });
  }) as typeof fetch;

  const wrapped = await cjRequest<{ ok: boolean }>({
    method: "GET",
    path: "/setting/get",
    operation: "cj.test.rate-limit-retry",
  });

  assert.equal(wrapped?.data?.ok, true);
  assert.equal(attempt, 2);
});

test("cjRequest fails closed on quota exhaustion", async () => {
  process.env.CJ_API_KEY = "test-key";
  global.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/authentication/getAccessToken")) {
      return jsonResponse({
        code: 200,
        result: true,
        data: {
          accessToken: "token-1",
          refreshToken: "refresh-1",
          accessTokenExpiresAt: Date.now() + 10 * 60 * 60 * 1000,
          refreshTokenExpiresAt: Date.now() + 120_000,
        },
      });
    }
    return jsonResponse({ code: 1600201, result: false, message: "quota exhausted" });
  }) as typeof fetch;

  await assert.rejects(
    () => cjRequest({ method: "GET", path: "/setting/get", operation: "cj.test.quota" }),
    (error: unknown) => error instanceof CjError && error.category === "QUOTA_EXHAUSTED"
  );
});

test("createCjOrder validates payload and order status mapping stays fail-closed", async () => {
  await assert.rejects(
    () =>
      createCjOrder({
        orderNumber: "1",
        shippingZip: "12345",
        shippingCountry: "US",
        shippingCountryCode: "US",
        shippingProvince: "CA",
        shippingCity: "SF",
        shippingPhone: "123",
        shippingCustomerName: "Buyer",
        shippingAddress: "1 Market",
        logisticName: "CJPacket",
        fromCountryCode: "CN",
        products: [{ quantity: 1 }],
      }),
    /sku or vid/
  );

  assert.equal(mapCjOrderStatusToPurchaseStatus("CREATED"), "SUBMITTED");
  assert.equal(mapCjOrderStatusToPurchaseStatus("UNSHIPPED"), "CONFIRMED");
  assert.equal(mapCjOrderStatusToPurchaseStatus("SHIPPED"), "CONFIRMED");
});

test("tracking extraction prefers canonical nested keys", () => {
  const raw = {
    logistics: {
      shippingMethod: "CJPacket Sensitive",
    },
    items: [{ trackingNo: "CJPKL7160102171YQ" }],
  };

  assert.equal(extractTrackingNumber(raw), "CJPKL7160102171YQ");
  assert.equal(extractTrackingCarrier(raw), "CJPacket Sensitive");
});

test("getCjOrderDetail reads canonical order fields", async () => {
  process.env.CJ_API_KEY = "test-key";
  global.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/authentication/getAccessToken")) {
      return jsonResponse({
        code: 200,
        result: true,
        data: {
          accessToken: "token-1",
          refreshToken: "refresh-1",
          accessTokenExpiresAt: Date.now() + 10 * 60 * 60 * 1000,
          refreshTokenExpiresAt: Date.now() + 120_000,
        },
      });
    }
    return jsonResponse({
      code: 200,
      result: true,
      data: {
        orderId: "123",
        orderNum: "EBAY-1",
        cjOrderId: "CJ-1",
        orderStatus: "SHIPPED",
        logisticName: "CJPacket",
        fromCountryCode: "CN",
        trackNumber: "TRACK-1",
      },
    });
  }) as typeof fetch;

  const detail = await getCjOrderDetail("123");
  assert.equal(detail.orderId, "123");
  assert.equal(detail.orderStatus, "SHIPPED");
  assert.equal(detail.trackNumber, "TRACK-1");
});


test("runtime failure classifier marks CJ rate limits as retryable upstream incidents", () => {
  const classified = classifyRuntimeFailure("RATE_LIMITED | code=1600200 | operation=cj.getAccessToken | CJ request failed: 429 Too Many Requests, QPS limit is 1 time/1second");
  assert.equal(classified.reasonCode, "UPSTREAM_RATE_LIMIT");
  assert.equal(classified.class, "infrastructure");
  assert.equal(classified.service, "runtime");
  assert.equal(classified.retryable, true);
});

test("CJ runtime diagnostics prefer live settings and shops over portal warning assumptions", async () => {
  process.env.CJ_API_KEY = "test-key";
  global.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/authentication/getAccessToken")) {
      return jsonResponse({
        code: 200,
        result: true,
        data: {
          accessToken: "token-1",
          refreshToken: "refresh-1",
          accessTokenExpiresAt: Date.now() + 10 * 60 * 60 * 1000,
          refreshTokenExpiresAt: Date.now() + 120_000,
        },
      });
    }
    if (url.includes("/setting/get")) {
      return jsonResponse({
        code: 200,
        result: true,
        data: {
          qps: 100,
          quota: 1000,
          remainingQuota: 998,
          sandbox: false,
          userLevel: "VIP",
        },
      });
    }
    if (url.includes("/shop/getShops")) {
      return jsonResponse({
        code: 200,
        result: true,
        data: [{ id: "shop-1", name: "Primary shop" }],
      });
    }
    throw new Error("unexpected url");
  }) as typeof fetch;

  const diagnostics = await getCjRuntimeDiagnostics();

  assert.equal(diagnostics.runtimeTruthStatus, "LIVE_VERIFIED");
  assert.equal(diagnostics.settings?.sandbox, false);
  assert.equal(diagnostics.settings?.qpsLimit, 100);
  assert.equal(diagnostics.settings?.quotaLimit, 1000);
  assert.equal(diagnostics.settings?.quotaRemaining, 998);
  assert.equal(typeof diagnostics.shopsCount, "number");
  assert.notEqual(diagnostics.shopHealth, "unknown");
  assert.match(diagnostics.runtimeTruthReason, /live CJ settings/i);
  assert.match(diagnostics.portalWarningPolicyNote, /informational only/i);
  assert.equal(diagnostics.auth.hasApiKey, true);
  assert.equal(diagnostics.auth.tokenFresh, true);
  assert.ok(diagnostics.auth.lastTokenRefreshAt);
  assert.ok(diagnostics.settings?.lastSuccessfulRefreshAt);
});

test("CJ endpoint policy keeps trackInfo primary and deprecated getTrackInfo out of runtime logic", () => {
  assert.ok(CJ_PRIMARY_RUNTIME_ENDPOINTS.includes("/logistic/trackInfo"));
  assert.ok(!CJ_PRIMARY_RUNTIME_ENDPOINTS.join(",").includes("/logistic/getTrackInfo"));
  assert.deepEqual(CJ_DEPRECATED_RUNTIME_ENDPOINTS, ["/logistic/getTrackInfo"]);
  assert.deepEqual(CJ_DOCUMENTED_CREATE_ORDER_ENDPOINTS, [
    "/shopping/order/createOrderV2",
    "/shopping/order/createOrderV3",
  ]);
  assert.equal(CJ_CANONICAL_CREATE_ORDER_ENDPOINT, "/shopping/order/createOrderV3");
});


test("CJ proof-state summary stays fail-closed for order creation", () => {
  const summary = getCjProofStateSummary({
    raw: null,
    qpsLimit: 100,
    quotaLimit: 1000,
    quotaRemaining: 997,
    userLevel: null,
    salesLevel: null,
    sandbox: false,
    operationalState: "verified-like",
    lastSuccessfulRefreshAt: null,
  });

  assert.equal(summary.auth, "PROVEN");
  assert.equal(summary.freight, "PROVEN");
  assert.equal(summary.orderCreate, "UNPROVEN");
  assert.equal(summary.orderDetail, "PARTIALLY_PROVEN");
  assert.equal(summary.tracking, "UNPROVEN");
  assert.ok(getCjProofRiskFlags(summary).includes("CJ_ORDER_CREATE_UNPROVEN"));
  assert.ok(getCjProofRiskFlags(summary).includes("CJ_TRACKING_UNPROVEN"));

  const parsed = readCjProofStateFromRawPayload({ cjProofState: summary });
  assert.equal(parsed?.orderCreate, "UNPROVEN");
  assert.equal(parsed?.orderDetail, "PARTIALLY_PROVEN");
  assert.equal(parsed?.stock, "PROVEN");
  assert.equal(parsed?.tracking, "UNPROVEN");
});
