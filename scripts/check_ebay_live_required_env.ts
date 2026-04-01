import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

function val(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

function mask(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return `set(len=${value.length})`;
  return `${value.slice(0, 2)}***${value.slice(-2)} (len=${value.length})`;
}

function resolveRefreshTokenCandidate(): {
  value: string | null;
  source: "EBAY_REFRESH_TOKEN" | "EBAY_USER_REFRESH_TOKEN" | null;
  invalidSources: Array<"EBAY_REFRESH_TOKEN" | "EBAY_USER_REFRESH_TOKEN">;
} {
  const candidates: Array<{
    key: "EBAY_REFRESH_TOKEN" | "EBAY_USER_REFRESH_TOKEN";
    value: string | null;
  }> = [
    { key: "EBAY_REFRESH_TOKEN", value: val("EBAY_REFRESH_TOKEN") },
    { key: "EBAY_USER_REFRESH_TOKEN", value: val("EBAY_USER_REFRESH_TOKEN") },
  ];
  const invalidSources: Array<"EBAY_REFRESH_TOKEN" | "EBAY_USER_REFRESH_TOKEN"> = [];

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    if (candidate.value.length >= 20) {
      return {
        value: candidate.value,
        source: candidate.key,
        invalidSources,
      };
    }
    invalidSources.push(candidate.key);
  }

  return {
    value: null,
    source: null,
    invalidSources,
  };
}

function checkNumeric(name: string, value: string | null, errors: string[]) {
  if (!value) {
    errors.push(`Missing ${name}.`);
    return;
  }
  if (!/^\d+$/.test(value)) {
    errors.push(`Invalid ${name}: expected numeric string.`);
  }
}

function main() {
  const refreshToken = resolveRefreshTokenCandidate();
  const required = {
    EBAY_REFRESH_TOKEN: refreshToken.value,
    EBAY_MERCHANT_LOCATION_KEY: val("EBAY_MERCHANT_LOCATION_KEY") || val("EBAY_LOCATION_KEY"),
    EBAY_PAYMENT_POLICY_ID: val("EBAY_PAYMENT_POLICY_ID") || val("EBAY_POLICY_PAYMENT_ID"),
    EBAY_RETURN_POLICY_ID: val("EBAY_RETURN_POLICY_ID") || val("EBAY_POLICY_RETURN_ID"),
    EBAY_FULFILLMENT_POLICY_ID:
      val("EBAY_FULFILLMENT_POLICY_ID") ||
      val("EBAY_POLICY_FULFILLMENT_ID") ||
      val("EBAY_SHIPPING_POLICY_ID"),
    EBAY_DEFAULT_CATEGORY_ID: val("EBAY_DEFAULT_CATEGORY_ID") || val("EBAY_CATEGORY_ID"),
  };

  const errors: string[] = [];

  if (!required.EBAY_REFRESH_TOKEN) {
    if (refreshToken.invalidSources.length > 0) {
      errors.push(
        `Invalid ${refreshToken.invalidSources.join(" / ")}: value appears too short to be a valid eBay refresh token.`
      );
    } else {
      errors.push("Missing EBAY_REFRESH_TOKEN (or EBAY_USER_REFRESH_TOKEN).");
    }
  }

  if (!required.EBAY_MERCHANT_LOCATION_KEY) {
    errors.push("Missing EBAY_MERCHANT_LOCATION_KEY (or EBAY_LOCATION_KEY).");
  }

  checkNumeric("EBAY_PAYMENT_POLICY_ID", required.EBAY_PAYMENT_POLICY_ID, errors);
  checkNumeric("EBAY_RETURN_POLICY_ID", required.EBAY_RETURN_POLICY_ID, errors);
  checkNumeric("EBAY_FULFILLMENT_POLICY_ID", required.EBAY_FULFILLMENT_POLICY_ID, errors);
  checkNumeric("EBAY_DEFAULT_CATEGORY_ID", required.EBAY_DEFAULT_CATEGORY_ID, errors);

  console.log("eBay live required config (redacted):");
  console.table({
    EBAY_REFRESH_TOKEN: mask(required.EBAY_REFRESH_TOKEN),
    EBAY_MERCHANT_LOCATION_KEY: required.EBAY_MERCHANT_LOCATION_KEY,
    EBAY_PAYMENT_POLICY_ID: required.EBAY_PAYMENT_POLICY_ID,
    EBAY_RETURN_POLICY_ID: required.EBAY_RETURN_POLICY_ID,
    EBAY_FULFILLMENT_POLICY_ID: required.EBAY_FULFILLMENT_POLICY_ID,
    EBAY_DEFAULT_CATEGORY_ID: required.EBAY_DEFAULT_CATEGORY_ID,
  });

  if (errors.length) {
    console.error("Missing/invalid eBay live required config:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("All required eBay live publish config is present.");
}

main();
