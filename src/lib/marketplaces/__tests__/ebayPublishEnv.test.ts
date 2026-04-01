import test from "node:test";
import assert from "node:assert/strict";

import { getEbayPublishEnvValidation } from "@/lib/marketplaces/ebayPublish";

const REQUIRED_ENV = {
  WEBSITE_URL: "https://quickaibuy.com",
  EBAY_CLIENT_ID: "client-id",
  EBAY_CLIENT_SECRET: "client-secret",
  EBAY_MARKETPLACE_ID: "EBAY_US",
  EBAY_MERCHANT_LOCATION_KEY: "quickaibuy_global",
  EBAY_PAYMENT_POLICY_ID: "266463038016",
  EBAY_RETURN_POLICY_ID: "266463094016",
  EBAY_FULFILLMENT_POLICY_ID: "266463552016",
  EBAY_DEFAULT_CATEGORY_ID: "20614",
} as const;

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void
) {
  const keys = [
    ...Object.keys(REQUIRED_ENV),
    "EBAY_REFRESH_TOKEN",
    "EBAY_USER_REFRESH_TOKEN",
    ...Object.keys(overrides),
  ];
  const previous = new Map<string, string | undefined>();

  for (const key of keys) {
    previous.set(key, process.env[key]);
  }

  Object.assign(process.env, REQUIRED_ENV);

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("prefers valid EBAY_USER_REFRESH_TOKEN when EBAY_REFRESH_TOKEN is too short", () => {
  withEnv(
    {
      EBAY_REFRESH_TOKEN: "short",
      EBAY_USER_REFRESH_TOKEN: "v".repeat(64),
    },
    () => {
      const validation = getEbayPublishEnvValidation();

      assert.equal(validation.ok, true);
      assert.equal(validation.config?.refreshToken, "v".repeat(64));
      assert.equal(validation.redacted.EBAY_REFRESH_TOKEN, "set(len=64)");
      assert.equal(
        validation.errors.some((error) => error.includes("too short")),
        false
      );
    }
  );
});

test("fails closed when only short refresh tokens are present", () => {
  withEnv(
    {
      EBAY_REFRESH_TOKEN: "short",
      EBAY_USER_REFRESH_TOKEN: "tiny",
    },
    () => {
      const validation = getEbayPublishEnvValidation();

      assert.equal(validation.ok, false);
      assert.equal(validation.config, null);
      assert.match(
        validation.errors.join(" | "),
        /Invalid EBAY_REFRESH_TOKEN \/ EBAY_USER_REFRESH_TOKEN: value is too short/
      );
    }
  );
});
