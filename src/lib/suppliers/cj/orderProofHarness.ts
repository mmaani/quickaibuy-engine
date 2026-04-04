import type { CjCreateOrderInput } from "./types";

export type CjProofHarnessPreparedRun = {
  execute: boolean;
  actorId: string;
  runId: string;
  entityId: string;
  orderInput: CjCreateOrderInput;
  maskedInput: Record<string, unknown>;
  guardrails: string[];
};

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitCsv(value: string | null): string[] {
  return Array.from(new Set((value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)));
}

function requireEnv(name: string, env: Record<string, string | undefined>): string {
  const value = cleanString(env[name]);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function maskName(value: string): string {
  return value.length <= 2 ? `${value[0] ?? "*"}*` : `${value.slice(0, 2)}***`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D+/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

function maskEmail(value: string | null): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  const [local, domain] = cleaned.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) return "***";
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-2)}`;
}

function assertInternalOnly(value: string, label: string, marker: string): void {
  const normalized = value.toLowerCase();
  const tokens = ["internal", "proof", "quickaibuy", marker.toLowerCase()];
  if (!tokens.some((token) => token && normalized.includes(token))) {
    throw new Error(`${label} must clearly indicate internal non-customer proof usage`);
  }
}

export function prepareCjOrderProofHarnessRun(input?: {
  env?: Record<string, string | undefined>;
  argv?: string[];
  now?: Date;
}): CjProofHarnessPreparedRun {
  const env = input?.env ?? process.env;
  const argv = input?.argv ?? process.argv.slice(2);
  const now = input?.now ?? new Date();
  const execute = argv.includes("--execute");

  const mode = requireEnv("CJ_PROOF_HARNESS_MODE", env);
  if (mode !== "internal_non_customer") {
    throw new Error("CJ_PROOF_HARNESS_MODE must equal internal_non_customer");
  }

  if (execute) {
    const confirmation = requireEnv("CJ_PROOF_HARNESS_CONFIRM", env);
    if (confirmation !== "CREATE_REAL_CJ_PROOF_ORDER") {
      throw new Error("CJ_PROOF_HARNESS_CONFIRM must equal CREATE_REAL_CJ_PROOF_ORDER when --execute is used");
    }
  }

  const actorId = requireEnv("CJ_PROOF_OPERATOR_ID", env);
  const marker = cleanString(env.CJ_PROOF_INTERNAL_MARKER) ?? "INTERNAL PROOF";
  const shippingCustomerName = requireEnv("CJ_PROOF_INTERNAL_RECIPIENT_NAME", env);
  const shippingAddress = requireEnv("CJ_PROOF_INTERNAL_ADDRESS1", env);
  const shippingAddress2 = cleanString(env.CJ_PROOF_INTERNAL_ADDRESS2);
  const shippingCity = requireEnv("CJ_PROOF_INTERNAL_CITY", env);
  const shippingProvince = requireEnv("CJ_PROOF_INTERNAL_PROVINCE", env);
  const shippingCounty = cleanString(env.CJ_PROOF_INTERNAL_COUNTY);
  const shippingZip = requireEnv("CJ_PROOF_INTERNAL_ZIP", env);
  const shippingCountry = requireEnv("CJ_PROOF_INTERNAL_COUNTRY", env);
  const shippingCountryCode = requireEnv("CJ_PROOF_INTERNAL_COUNTRY_CODE", env);
  const shippingPhone = requireEnv("CJ_PROOF_INTERNAL_PHONE", env);
  const email = cleanString(env.CJ_PROOF_INTERNAL_EMAIL);
  const logisticName = requireEnv("CJ_PROOF_INTERNAL_LOGISTIC_NAME", env);
  const fromCountryCode = requireEnv("CJ_PROOF_INTERNAL_FROM_COUNTRY_CODE", env);
  const productVids = splitCsv(cleanString(env.CJ_PROOF_TEST_VIDS));
  const productSkus = splitCsv(cleanString(env.CJ_PROOF_TEST_SKUS));
  const quantity = Math.max(1, Number(cleanString(env.CJ_PROOF_TEST_QUANTITY) ?? "1"));

  if (!productVids.length && !productSkus.length) {
    throw new Error("At least one CJ_PROOF_TEST_VIDS or CJ_PROOF_TEST_SKUS value is required");
  }

  assertInternalOnly(shippingCustomerName, "CJ_PROOF_INTERNAL_RECIPIENT_NAME", marker);
  assertInternalOnly(shippingAddress, "CJ_PROOF_INTERNAL_ADDRESS1", marker);
  assertInternalOnly(actorId, "CJ_PROOF_OPERATOR_ID", marker);
  if (email) {
    const normalizedEmail = email.toLowerCase();
    if (!normalizedEmail.endsWith("@quickaibuy.com") && !normalizedEmail.includes("internal")) {
      throw new Error("CJ_PROOF_INTERNAL_EMAIL must be an internal mailbox");
    }
  }

  const runId = `cj-proof-${now.toISOString().replace(/[:.]/g, "-")}`;
  const orderNumber = `CJ-PROOF-INTERNAL-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
  const remark = `${marker} manual disposable order proof run ${runId}`;

  const products = [
    ...productVids.map((vid) => ({ vid, quantity })),
    ...productSkus.map((sku) => ({ sku, quantity })),
  ];

  const orderInput: CjCreateOrderInput = {
    orderNumber,
    shippingZip,
    shippingCountry,
    shippingCountryCode,
    shippingProvince,
    shippingCity,
    shippingCounty,
    shippingPhone,
    shippingCustomerName,
    shippingAddress,
    shippingAddress2,
    email,
    remark,
    logisticName,
    fromCountryCode,
    platform: "internal-proof",
    products,
  };

  return {
    execute,
    actorId,
    runId,
    entityId: orderNumber,
    orderInput,
    maskedInput: {
      orderNumber,
      platform: orderInput.platform,
      marker,
      recipient: maskName(shippingCustomerName),
      email: maskEmail(email),
      phone: maskPhone(shippingPhone),
      address: maskAddress(shippingAddress),
      address2Present: Boolean(shippingAddress2),
      city: shippingCity,
      province: shippingProvince,
      country: shippingCountry,
      countryCode: shippingCountryCode,
      logisticName,
      fromCountryCode,
      products: products.map((product) => ({ vid: "vid" in product ? cleanString(product.vid) : null, sku: "sku" in product ? cleanString(product.sku) : null, quantity: product.quantity })),
      execute,
      balancePaymentAttempted: false,
    },
    guardrails: [
      "internal-only-test-products",
      "internal-recipient-only",
      "manual-operator-trigger-only",
      "no-customer-data",
      "no-balance-payment",
      "immediate-order-detail-follow-up",
      "operator-visible-secret-safe-audit",
      "not-invocable-from-normal-customer-flows",
      "normal-flows-remain-CJ_ORDER_CREATE_UNPROVEN",
    ],
  };
}
