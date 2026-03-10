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
  const required = {
    EBAY_REFRESH_TOKEN: val("EBAY_REFRESH_TOKEN") || val("EBAY_USER_REFRESH_TOKEN"),
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
    errors.push("Missing EBAY_REFRESH_TOKEN (or EBAY_USER_REFRESH_TOKEN).");
  } else if (required.EBAY_REFRESH_TOKEN.length < 20) {
    errors.push("Invalid EBAY_REFRESH_TOKEN: value appears too short.");
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
