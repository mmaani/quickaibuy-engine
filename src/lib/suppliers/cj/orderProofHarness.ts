import { calculateCjFreightTip, type CjFreightCalculateTipQuote } from "./logistics";
import { queryCjVariantByVid } from "./products";
import type { CjVariantRecord } from "./products";
import type { CjCreateOrderInput } from "./types";

const CJ_PROOF_FREIGHT_TIP_DEFAULT_WEIGHT_GRAMS = 200;
const CJ_PROOF_FREIGHT_TIP_DEFAULT_VOLUME_CM3 = 1000;
const CJ_PROOF_FREIGHT_TIP_DEFAULT_PLATFORM = "Shopify";

type FreightTipResolver = (input: { reqDTOS: Array<Record<string, unknown>> }) => Promise<CjFreightCalculateTipQuote[]>;
type VariantLookupResolver = (vid: string) => Promise<CjVariantRecord | null>;

type CjFreightTipLogisticsOption = NonNullable<CjFreightCalculateTipQuote["logisticsList"]>[number];

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

function extractVariantSku(row: CjVariantRecord | null): string | null {
  if (!row) return null;
  for (const key of ["sku", "SKU", "productSku", "variantSku"]) {
    const value = cleanString(row[key]);
    if (value) return value;
  }
  return null;
}

function isValidLogisticsOption(option: CjFreightTipLogisticsOption | null | undefined): option is CjFreightTipLogisticsOption {
  if (!option) return false;
  return !cleanString(option.error) && !cleanString(option.errorEn) && Boolean(cleanString(option.logisticName));
}

function selectFirstValidLogisticsOption(quotes: CjFreightCalculateTipQuote[]): { option: CjFreightTipLogisticsOption; quoteCount: number } | null {
  for (const quote of quotes) {
    const logisticsList = Array.isArray(quote.logisticsList) ? quote.logisticsList : [];
    const firstValid = logisticsList.find((entry) => isValidLogisticsOption(entry));
    if (firstValid) {
      return { option: firstValid, quoteCount: quotes.length };
    }
  }
  return null;
}

async function resolveProofHarnessLogisticName(input: {
  env: Record<string, string | undefined>;
  destinationCountryCode: string;
  fromCountryCode: string;
  productVids: string[];
  quantity: number;
  calculateFreightTip: FreightTipResolver;
  queryVariantByVid: VariantLookupResolver;
}): Promise<{
  logisticName: string;
  source: "manual-override" | "freight-tip-logistics-list";
  quoteCount: number;
  requestedVid: string;
  requestedQuantity: number;
  requestedDestinationCountryCode: string;
}> {
  const manualOverride = cleanString(input.env.CJ_PROOF_INTERNAL_LOGISTIC_NAME);
  if (manualOverride) {
    return {
      logisticName: manualOverride,
      source: "manual-override",
      quoteCount: 0,
      requestedVid: input.productVids[0] ?? "",
      requestedQuantity: input.quantity,
      requestedDestinationCountryCode: input.destinationCountryCode,
    };
  }

  const requestedVid = cleanString(input.productVids[0]);
  if (!requestedVid) {
    throw new Error("CJ proof harness requires CJ_PROOF_TEST_VIDS when no explicit logisticName override is provided");
  }

  const variant = await input.queryVariantByVid(requestedVid);
  const sku = extractVariantSku(variant);
  if (!sku) {
    throw new Error(`CJ proof harness could not resolve sku for vid ${requestedVid}`);
  }

  const quotes = await input.calculateFreightTip({
    reqDTOS: [
      {
        srcAreaCode: input.fromCountryCode,
        destAreaCode: input.destinationCountryCode,
        skuList: [sku],
        freightTrialSkuList: [
          {
            sku,
            vid: requestedVid,
            skuQuantity: input.quantity,
          },
        ],
        weight: Math.max(CJ_PROOF_FREIGHT_TIP_DEFAULT_WEIGHT_GRAMS, input.quantity * CJ_PROOF_FREIGHT_TIP_DEFAULT_WEIGHT_GRAMS),
        wrapWeight: 0,
        volume: Math.max(CJ_PROOF_FREIGHT_TIP_DEFAULT_VOLUME_CM3, input.quantity * CJ_PROOF_FREIGHT_TIP_DEFAULT_VOLUME_CM3),
        productProp: ["COMMON"],
        platforms: [CJ_PROOF_FREIGHT_TIP_DEFAULT_PLATFORM],
      },
    ],
  });

  const selected = selectFirstValidLogisticsOption(quotes);
  const logisticName = cleanString(selected?.option.logisticName);
  if (!selected || !logisticName) {
    throw new Error("CJ proof harness could not resolve logisticsList[0].logisticName from freightCalculateTip");
  }

  return {
    logisticName,
    source: "freight-tip-logistics-list",
    quoteCount: selected.quoteCount,
    requestedVid,
    requestedQuantity: input.quantity,
    requestedDestinationCountryCode: input.destinationCountryCode,
  };
}

export async function prepareCjOrderProofHarnessRun(input?: {
  env?: Record<string, string | undefined>;
  argv?: string[];
  now?: Date;
  calculateFreightTip?: FreightTipResolver;
  queryVariantByVid?: VariantLookupResolver;
}): Promise<CjProofHarnessPreparedRun> {
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

  const freightTipResolver = input?.calculateFreightTip ?? calculateCjFreightTip;
  const variantLookupResolver = input?.queryVariantByVid ?? queryCjVariantByVid;
  const logisticResolution = await resolveProofHarnessLogisticName({
    env,
    destinationCountryCode: shippingCountryCode,
    fromCountryCode,
    productVids,
    quantity,
    calculateFreightTip: freightTipResolver,
    queryVariantByVid: variantLookupResolver,
  });

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
    logisticName: logisticResolution.logisticName,
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
      logisticName: logisticResolution.logisticName,
      logisticSource: logisticResolution.source,
      freightTipQuoteCount: logisticResolution.quoteCount,
      requestedVid: logisticResolution.requestedVid,
      requestedQuantity: logisticResolution.requestedQuantity,
      requestedDestinationCountryCode: logisticResolution.requestedDestinationCountryCode,
      fromCountryCode,
      products: products.map((product) => ({
        vid: "vid" in product ? cleanString(product.vid) : null,
        sku: "sku" in product ? cleanString(product.sku) : null,
        quantity: product.quantity,
      })),
      execute,
      balancePaymentAttempted: false,
    },
    guardrails: [
      "internal-only-test-products",
      "internal-recipient-only",
      "manual-operator-trigger-only",
      "no-customer-data",
      "no-balance-payment",
      "freight-tip-derived-logisticsList-selection",
      "immediate-order-detail-follow-up",
      "operator-visible-secret-safe-audit",
      "not-invocable-from-normal-customer-flows",
      "tracking-remains-CJ_TRACKING_UNPROVEN",
    ],
  };
}
