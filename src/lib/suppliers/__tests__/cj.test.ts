import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetCjAuthForTests,
  __resetCjClientForTests,
  cjRequest,
  CjError,
  createCjOrder,
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

test("cjRequest fails closed on invalid refresh token", async () => {
  process.env.CJ_API_KEY = "test-key";
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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
      return jsonResponse({ code: 1600003, result: false, message: "invalid refresh token" });
    }
    const token = (init?.headers as Record<string, string>)?.["CJ-Access-Token"];
    if (token === "token-1") {
      return jsonResponse({ code: 1600001, result: false, message: "invalid access token" });
    }
    return jsonResponse({ code: 200, result: true, data: { ok: true } });
  }) as typeof fetch;

  await assert.rejects(
    () => cjRequest({ method: "GET", path: "/setting/get", operation: "cj.test.invalid-refresh" }),
    (error: unknown) => error instanceof CjError && error.category === "REFRESH_INVALID"
  );
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
          accessTokenExpiresAt: Date.now() + 60_000,
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
          accessTokenExpiresAt: Date.now() + 60_000,
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
          accessTokenExpiresAt: Date.now() + 60_000,
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
