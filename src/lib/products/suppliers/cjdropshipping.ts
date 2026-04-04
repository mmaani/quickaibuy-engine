import type { ProductVariant, ShippingEstimate, SupplierProduct } from "./types";
import { normalizeShipFromCountry } from "@/lib/products/shipFromCountry";
import {
  buildCjProofStateSnapshot,
  calculateCjFreight,
  calculateCjFreightTip,
  getCjDirectProductSnapshot,
  searchCjProducts,
} from "@/lib/suppliers/cj";

type CjInventoryEntry = {
  areaEn?: string;
  countryCode?: string;
  countryNameEn?: string;
  inventoryNum?: number | string;
  realInventoryNum?: number | string;
  cjInventoryNum?: number | string;
  factoryInventoryNum?: number | string;
};

type CjVariantInventory = {
  vid?: string;
  inventory?: Array<{
    totalInventory?: number | string;
    cjInventory?: number | string;
    factoryInventory?: number | string;
    countryCode?: string;
  }>;
};

type CjStanProduct = {
  ID?: string;
  IMG?: string;
  NAMEEN?: string;
  SELLPRICE?: string | number;
  SKU?: string;
  VARIANTKEY?: string;
  expandField?: string;
};

type CjProductDetailData = {
  ID?: string;
  NAMEEN?: string;
  NAME?: string;
  SELLPRICE?: string;
  SKU?: string;
  IMG?: string;
  BIGIMG?: string;
  newImgList?: string[];
  stanProducts?: CjStanProduct[];
  goodsJsonSearch?: string;
  verifiedWarehouse?: number | string;
  saleStatus?: string | number;
  sourceFrom?: string | number;
  updatePriceDate?: string | number;
  isUnsold?: string | number;
  PROPERTYEN?: string;
  VARIANTKEYEN?: string;
  video?: string;
  videoUrl?: string;
  goodsVideo?: string;
  videoUrlList?: string[];
  productVideo?: string;
  DESCRIPTION?: string;
  xiaoShouJianYi?: string;
};



type CjSearchProduct = {
  id?: string;
  nameEn?: string;
  bigImage?: string;
  sellPrice?: string | number;
  discountPrice?: string | number;
  listedNum?: number | string;
  categoryId?: string;
  threeCategoryName?: string;
  twoCategoryName?: string;
  oneCategoryName?: string;
  isVideo?: number | string;
  videoList?: string[];
  supplierName?: string;
  warehouseInventoryNum?: number | string;
  totalVerifiedInventory?: number | string;
  totalUnVerifiedInventory?: number | string;
  verifiedWarehouse?: number | string;
  deliveryCycle?: string;
  description?: string;
  saleStatus?: string | number;
  authorityStatus?: string | number;
  hasCECertification?: number | string;
  customization?: number | string;
  isPersonalized?: number | string;
  variantKeyEn?: string;
};


type CjFreightCalculateQuote = {
  logisticAging?: string;
  logisticPrice?: number | string;
  logisticPriceCn?: number | string;
  logisticName?: string;
  taxesFee?: number | string;
  clearanceOperationFee?: number | string;
  totalPostageFee?: number | string;
};

type CjFreightCalculateTipQuote = {
  arrivalTime?: string;
  discountFee?: number | string;
  postage?: number | string;
  wrapPostage?: number | string;
  taxesFee?: number | string;
  clearanceOperationFee?: number | string;
  option?: {
    enName?: string;
    cnName?: string;
    id?: string;
  };
  channel?: {
    enName?: string;
    cnName?: string;
    id?: string;
  };
  srcArea?: {
    shortCode?: string;
    enName?: string;
  };
  destArea?: {
    shortCode?: string;
    enName?: string;
  };
  message?: string;
  error?: string;
  errorEn?: string;
};

export type CjDirectProductResult = {
  product: SupplierProduct;
  priceMin: string | null;
  priceMax: string | null;
  stockCount: number | null;
  inventoryEvidenceText: string | null;
  detailCacheUrl: string;
  inventoryCacheUrl: string;
};

const CJ_FREIGHT_TIP_DEFAULT_WEIGHT_GRAMS = 200;
const CJ_FREIGHT_TIP_DEFAULT_VOLUME_CM3 = 1000;
const CJ_FREIGHT_TIP_DEFAULT_PLATFORM = "Shopify";

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPriceString(value: number | null): string | null {
  if (value == null) return null;
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function parsePriceRange(value: unknown): { min: number | null; max: number | null } {
  const raw = String(value ?? "").trim();
  if (!raw) return { min: null, max: null };

  const matches = Array.from(raw.matchAll(/[0-9]+(?:\.[0-9]{1,2})?/g)).map((match) =>
    Number(match[0])
  );
  const numbers = matches.filter((value) => Number.isFinite(value));

  if (!numbers.length) return { min: null, max: null };
  return {
    min: Math.min(...numbers),
    max: Math.max(...numbers),
  };
}

function clampPositiveInteger(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(1, Math.round(value));
}

function stripHtmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImageUrls(detail: CjProductDetailData): string[] {
  const rawImages = Array.isArray(detail.newImgList)
    ? detail.newImgList
    : String(detail.IMG ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  const withPrimary = [detail.BIGIMG, ...rawImages]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return Array.from(new Set(withPrimary)).slice(0, 48);
}

function normalizeVideoUrls(detail: CjProductDetailData): string[] {
  const raw = [
    detail.video,
    detail.videoUrl,
    detail.goodsVideo,
    detail.productVideo,
    ...(Array.isArray(detail.videoUrlList) ? detail.videoUrlList : []),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return Array.from(new Set(raw)).slice(0, 5);
}

function computeCjMediaQualityScore(imageCount: number, videoCount: number): number {
  if (imageCount >= 5 && videoCount > 0) return 0.94;
  if (imageCount >= 5) return 0.88;
  if (imageCount >= 3 && videoCount > 0) return 0.86;
  if (imageCount >= 3) return 0.78;
  if (imageCount > 0 || videoCount > 0) return 0.64;
  return 0.3;
}

function parseVariantValues(expandField: string | undefined): string[] {
  if (!expandField) return [];
  try {
    const parsed = JSON.parse(expandField) as { values?: Record<string, unknown> };
    const values = parsed.values ?? {};
    return Object.values(values)
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeVariants(detail: CjProductDetailData): ProductVariant[] {
  const stanProducts = Array.isArray(detail.stanProducts) ? detail.stanProducts : [];
  const values = new Set<string>();

  for (const variant of stanProducts.slice(0, 20)) {
    const variantKey = toNonEmptyString(variant.VARIANTKEY);
    if (variantKey) values.add(variantKey);
    for (const value of parseVariantValues(variant.expandField)) {
      values.add(value);
    }
  }

  return Array.from(values).map((value) => ({ name: "option", value }));
}

function buildCjVariantMapping(
  stanProducts: CjStanProduct[] | undefined
): Array<Record<string, unknown>> {
  return (Array.isArray(stanProducts) ? stanProducts : [])
    .slice(0, 50)
    .map((variant) => ({
      sku: toNonEmptyString(variant.SKU),
      variantKey: toNonEmptyString(variant.VARIANTKEY),
      optionValues: parseVariantValues(variant.expandField),
      sellPrice: toNonEmptyString(String(variant.SELLPRICE ?? "")),
      image: toNonEmptyString(variant.IMG),
      name: toNonEmptyString(variant.NAMEEN),
      stanProductId: toNonEmptyString(variant.ID),
    }));
}

function sumInventoryValues(entries: CjInventoryEntry[] | undefined, key: keyof CjInventoryEntry): number {
  return (entries ?? []).reduce((sum, entry) => sum + (toFiniteNumber(entry[key]) ?? 0), 0);
}

function sumVariantInventories(entries: CjVariantInventory[] | undefined): number {
  return (entries ?? []).reduce((sum, variant) => {
    const inventoryRows = Array.isArray(variant.inventory) ? variant.inventory : [];
    return (
      sum +
      inventoryRows.reduce((inner, row) => {
        const total =
          toFiniteNumber(row.totalInventory) ??
          (toFiniteNumber(row.cjInventory) ?? 0) + (toFiniteNumber(row.factoryInventory) ?? 0);
        return inner + (total ?? 0);
      }, 0)
    );
  }, 0);
}

function buildInventoryEvidenceText(entries: CjInventoryEntry[] | undefined): string | null {
  const first = (entries ?? [])[0];
  if (!first) return null;
  const label =
    toNonEmptyString(first.countryNameEn) ??
    toNonEmptyString(first.areaEn) ??
    toNonEmptyString(first.countryCode) ??
    "warehouse";
  const total = toFiniteNumber(first.inventoryNum);
  const real = toFiniteNumber(first.realInventoryNum);
  const factory = toFiniteNumber(first.factoryInventoryNum);

  const segments = [`${label} inventory`];
  if (total != null) segments.push(String(total));
  if (real != null) segments.push(`verified ${real}`);
  if (factory != null) segments.push(`factory ${factory}`);
  return segments.join(" | ");
}

export function parseCjProductIdFromUrl(sourceUrl: string): string | null {
  const raw = String(sourceUrl ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/-p-([A-Z0-9-]{8,})\.html/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function parseTitleFromCjSourceUrl(sourceUrl: string): string | null {
  const raw = String(sourceUrl ?? "").trim();
  if (!raw) return null;

  try {
    const pathname = new URL(raw).pathname;
    const slugMatch = pathname.match(/\/product\/(.+)-p-[A-Z0-9-]{8,}\.html$/i);
    const slug = slugMatch?.[1]?.trim();
    if (!slug) return null;

    const title = slug
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .map((part) => titleCaseWord(part))
      .join(" ");

    return title || null;
  } catch {
    return null;
  }
}

function looksLikeCorruptedTitle(value: string | null): boolean {
  const title = String(value ?? "").trim();
  if (!title) return true;
  if (title.length < 8) return true;
  if (/\+/.test(title)) return true;

  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length >= 24) return true;

  const hasLetters = /[a-z]/i.test(title);
  const hasSpaces = /\s/.test(title);
  if (hasLetters && !hasSpaces && title.length >= 24) return true;

  return false;
}


function parseDeliveryCycleDays(value: unknown): { minDays: number | null; maxDays: number | null } {
  const raw = String(value ?? "").trim();
  const matches = Array.from(raw.matchAll(/\d+/g)).map((match) => Number(match[0]));
  if (!matches.length) return { minDays: null, maxDays: null };
  return {
    minDays: Math.min(...matches),
    maxDays: Math.max(...matches),
  };
}

function parseDayRangeFromText(
  text: string,
  patterns: RegExp[],
): { minDays: number | null; maxDays: number | null } | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const minDays = clampPositiveInteger(Number.parseFloat(match[1] ?? ""));
    const maxDays = clampPositiveInteger(Number.parseFloat(match[2] ?? match[1] ?? ""));
    if (minDays == null && maxDays == null) continue;
    return { minDays, maxDays };
  }
  return null;
}

function deriveShipFromCountry(text: string, warehouseCountry: string | null): string | null {
  return normalizeShipFromCountry(text) ?? normalizeShipFromCountry(warehouseCountry);
}

function buildCjDetailShippingEvidence(
  detail: CjProductDetailData,
  warehouseCountry: string | null,
): {
  estimates: ShippingEstimate[];
  signal: "PRESENT" | "PARTIAL" | "MISSING";
  evidenceText: string | null;
  shipFromCountry: string | null;
  shippingConfidence: number;
} {
  const rawEvidenceText = toNonEmptyString(detail.xiaoShouJianYi);
  if (!rawEvidenceText) {
    return {
      estimates: [],
      signal: "MISSING",
      evidenceText: null,
      shipFromCountry: null,
      shippingConfidence: 0.2,
    };
  }
  const evidenceText = stripHtmlToText(rawEvidenceText);
  if (!evidenceText) {
    return {
      estimates: [],
      signal: "MISSING",
      evidenceText: null,
      shipFromCountry: null,
      shippingConfidence: 0.2,
    };
  }

  const deliveryRange =
    parseDayRangeFromText(evidenceText, [
      /estimated delivery time(?: in [a-z ]+)?\s*(?:is|:)?\s*([0-9]+)\s*-\s*([0-9]+)\s*days?/i,
      /arrival time(?: is)? within\s*([0-9]+)\s*-\s*([0-9]+)\s*days?/i,
      /delivery time(?: is|:)?\s*([0-9]+)\s*-\s*([0-9]+)\s*days?/i,
      /processing time(?: is|:)?\s*([0-9]+)\s*-\s*([0-9]+)\s*days?/i,
    ]) ??
    parseDayRangeFromText(evidenceText, [
      /estimated delivery time(?: in [a-z ]+)?\s*(?:is|:)?(?: within)?\s*([0-9]+)\s*days?/i,
      /arrival time(?: is)? within\s*([0-9]+)\s*days?/i,
      /delivery time(?: is|:)?(?: within)?\s*([0-9]+)\s*days?/i,
    ]);
  const shippingFeeMatch = evidenceText.match(
    /shipping fee\s*[:\-]?\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/i,
  );
  const shipFromCountry = deriveShipFromCountry(evidenceText, warehouseCountry);

  if (!deliveryRange && !shippingFeeMatch && !shipFromCountry) {
    return {
      estimates: [],
      signal: "MISSING",
      evidenceText,
      shipFromCountry: null,
      shippingConfidence: 0.25,
    };
  }

  const estimates: ShippingEstimate[] = [
    {
      label: /\b(us|usa|united states)\b/i.test(evidenceText)
        ? "CJ US warehouse delivery"
        : "CJ warehouse delivery",
      cost: shippingFeeMatch?.[1] ?? null,
      currency: shippingFeeMatch ? "USD" : null,
      etaMinDays: deliveryRange?.minDays ?? null,
      etaMaxDays: deliveryRange?.maxDays ?? null,
      ship_from_country: shipFromCountry,
    },
  ];

  return {
    estimates,
    signal: deliveryRange || shippingFeeMatch ? "PRESENT" : "PARTIAL",
    evidenceText,
    shipFromCountry,
    shippingConfidence:
      deliveryRange && shippingFeeMatch
        ? 0.9
        : deliveryRange || shippingFeeMatch
          ? 0.82
          : shipFromCountry
            ? 0.72
            : 0.4,
  };
}

function buildCjShippingEstimates(product: CjSearchProduct) {
  const cycle = parseDeliveryCycleDays(product.deliveryCycle);
  if (cycle.minDays == null && cycle.maxDays == null) return [];

  return [
    {
      label: "CJ estimated delivery",
      cost: null,
      currency: "USD",
      etaMinDays: cycle.minDays,
      etaMaxDays: cycle.maxDays,
    },
  ];
}

function selectBestCjFreightQuote(quotes: CjFreightCalculateQuote[] | undefined): CjFreightCalculateQuote | null {
  const normalized = (Array.isArray(quotes) ? quotes : []).filter((quote) => quote && typeof quote === "object");
  if (!normalized.length) return null;

  const ranked = normalized
    .map((quote) => {
      const price =
        toFiniteNumber(quote.totalPostageFee) ??
        toFiniteNumber(quote.logisticPrice) ??
        toFiniteNumber(quote.logisticPriceCn);
      const aging = parseDeliveryCycleDays(quote.logisticAging);
      const maxDays = aging.maxDays ?? Number.POSITIVE_INFINITY;
      return { quote, price, maxDays };
    })
    .sort((left, right) => {
      if (left.price != null && right.price != null && left.price !== right.price) {
        return left.price - right.price;
      }
      if (left.price != null) return -1;
      if (right.price != null) return 1;
      return left.maxDays - right.maxDays;
    });

  return ranked[0]?.quote ?? null;
}

function selectBestCjFreightTipQuote(
  quotes: CjFreightCalculateTipQuote[] | undefined
): CjFreightCalculateTipQuote | null {
  const normalized = (Array.isArray(quotes) ? quotes : []).filter((quote) => quote && typeof quote === "object");
  if (!normalized.length) return null;

  const ranked = normalized
    .map((quote) => {
      const price =
        toFiniteNumber(quote.discountFee) ??
        toFiniteNumber(quote.wrapPostage) ??
        toFiniteNumber(quote.postage);
      const aging = parseDeliveryCycleDays(quote.arrivalTime);
      const maxDays = aging.maxDays ?? Number.POSITIVE_INFINITY;
      const hasExplicitError = Boolean(toNonEmptyString(quote.error) || toNonEmptyString(quote.errorEn));
      return { quote, price, maxDays, hasExplicitError };
    })
    .filter((entry) => !entry.hasExplicitError)
    .sort((left, right) => {
      if (left.price != null && right.price != null && left.price !== right.price) {
        return left.price - right.price;
      }
      if (left.price != null) return -1;
      if (right.price != null) return 1;
      return left.maxDays - right.maxDays;
    });

  return ranked[0]?.quote ?? null;
}

function buildCjFreightTipSkuInputs(
  detail: CjProductDetailData
): Array<{ sku: string; vid: string | null; skuQuantity: number }> {
  const stanProducts = Array.isArray(detail.stanProducts) ? detail.stanProducts : [];
  const fromVariants = stanProducts
    .map((variant) => ({
      sku: toNonEmptyString(variant.SKU),
      vid: toNonEmptyString(variant.ID),
      skuQuantity: 1,
    }))
    .filter((entry): entry is { sku: string; vid: string | null; skuQuantity: number } => Boolean(entry.sku));

  const deduped = Array.from(new Map(fromVariants.map((entry) => [entry.sku, entry])).values()).slice(0, 3);
  if (deduped.length) return deduped;

  const fallbackSku = toNonEmptyString(detail.SKU);
  if (!fallbackSku) return [];
  return [{ sku: fallbackSku, vid: null, skuQuantity: 1 }];
}

function buildCjFreightTipPayload(input: {
  detail: CjProductDetailData;
  warehouseCountry: string | null;
}): {
  startCountryCode: string;
  skuInputs: Array<{ sku: string; vid: string | null; skuQuantity: number }>;
  payload: Record<string, unknown>;
} | null {
  const skuInputs = buildCjFreightTipSkuInputs(input.detail);
  if (!skuInputs.length) return null;

  const startCountryCode = normalizeShipFromCountry(input.warehouseCountry ?? "CN") ?? "CN";
  const itemCount = skuInputs.reduce((sum, entry) => sum + entry.skuQuantity, 0);
  const weight = Math.max(CJ_FREIGHT_TIP_DEFAULT_WEIGHT_GRAMS, itemCount * CJ_FREIGHT_TIP_DEFAULT_WEIGHT_GRAMS);
  const volume = Math.max(CJ_FREIGHT_TIP_DEFAULT_VOLUME_CM3, itemCount * CJ_FREIGHT_TIP_DEFAULT_VOLUME_CM3);
  const totalGoodsAmount =
    parsePriceRange(input.detail.SELLPRICE).max ??
    (Array.isArray(input.detail.stanProducts) ? input.detail.stanProducts : []).reduce<number | null>((best, variant) => {
      const parsed = parsePriceRange(variant.SELLPRICE);
      if (parsed.max == null) return best;
      return best == null ? parsed.max : Math.max(best, parsed.max);
    }, null);

  return {
    startCountryCode,
    skuInputs,
    payload: {
      reqDTOS: [
        {
          srcAreaCode: startCountryCode,
          destAreaCode: "US",
          skuList: skuInputs.map((entry) => entry.sku),
          freightTrialSkuList: skuInputs.map((entry) => ({
            sku: entry.sku,
            vid: entry.vid ?? undefined,
            skuQuantity: entry.skuQuantity,
          })),
          weight,
          wrapWeight: 0,
          volume,
          productProp: ["COMMON"],
          platforms: [CJ_FREIGHT_TIP_DEFAULT_PLATFORM],
          totalGoodsAmount: totalGoodsAmount ?? undefined,
        },
      ],
    },
  };
}

async function fetchCjFreightTrialEstimateTip(input: {
  detail: CjProductDetailData;
  warehouseCountry: string | null;
}): Promise<{
  estimate: ShippingEstimate | null;
  diagnostics: Record<string, unknown>;
}> {
  const request = buildCjFreightTipPayload(input);
  if (!request) {
    return {
      estimate: null,
      diagnostics: {
        source: "cj-freight-calculate-tip",
        attempted: false,
        reason: "missing-sku",
      },
    };
  }

  let quotes: CjFreightCalculateTipQuote[] = [];
  try {
    quotes = await calculateCjFreightTip(request.payload as { reqDTOS: Array<Record<string, unknown>> });
  } catch (error) {
    return {
      estimate: null,
      diagnostics: {
        source: "cj-freight-calculate-tip",
        attempted: false,
        reason: error instanceof Error && error.message.includes("missing CJ_API_KEY") ? "missing-auth" : "request-failed",
        startCountryCode: request.startCountryCode,
        skuList: request.skuInputs.map((entry) => entry.sku),
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const selected = selectBestCjFreightTipQuote(quotes);
  if (!selected) {
    return {
      estimate: null,
      diagnostics: {
        source: "cj-freight-calculate-tip",
        attempted: true,
        reason: "no-quotes",
        startCountryCode: request.startCountryCode,
        skuList: request.skuInputs.map((entry) => entry.sku),
        quoteCount: quotes.length,
      },
    };
  }

  const aging = parseDeliveryCycleDays(selected.arrivalTime);
  const price = toPriceString(
    toFiniteNumber(selected.discountFee) ??
      toFiniteNumber(selected.wrapPostage) ??
      toFiniteNumber(selected.postage)
  );
  const shipFromCountry =
    normalizeShipFromCountry(selected.srcArea?.shortCode ?? selected.srcArea?.enName ?? request.startCountryCode) ??
    request.startCountryCode;

  return {
    estimate: {
      label:
        toNonEmptyString(selected.option?.enName) ??
        toNonEmptyString(selected.channel?.enName) ??
        "CJ freight calculation tip",
      cost: price,
      currency: price ? "USD" : null,
      etaMinDays: aging.minDays,
      etaMaxDays: aging.maxDays,
      ship_from_country: shipFromCountry,
    },
    diagnostics: {
      source: "cj-freight-calculate-tip",
      attempted: true,
      startCountryCode: request.startCountryCode,
      skuList: request.skuInputs.map((entry) => entry.sku),
      quoteCount: quotes.length,
      selectedLabel:
        toNonEmptyString(selected.option?.enName) ??
        toNonEmptyString(selected.channel?.enName) ??
        null,
      selectedArrivalTime: toNonEmptyString(selected.arrivalTime),
      selectedDiscountFee: toFiniteNumber(selected.discountFee),
      selectedWrapPostage: toFiniteNumber(selected.wrapPostage),
      selectedPostage: toFiniteNumber(selected.postage),
      selectedMessage: toNonEmptyString(selected.message),
      srcAreaCode: toNonEmptyString(selected.srcArea?.shortCode),
      destAreaCode: toNonEmptyString(selected.destArea?.shortCode),
    },
  };
}

async function fetchCjFreightTrialEstimate(input: {
  detail: CjProductDetailData;
  warehouseCountry: string | null;
}): Promise<{
  estimate: ShippingEstimate | null;
  diagnostics: Record<string, unknown>;
}> {
  const variantIds = Array.from(
    new Set(
      (Array.isArray(input.detail.stanProducts) ? input.detail.stanProducts : [])
        .map((variant) => toNonEmptyString(variant.ID))
        .filter((value): value is string => Boolean(value))
    )
  ).slice(0, 3);
  const startCountryCode = normalizeShipFromCountry(input.warehouseCountry ?? "CN") ?? "CN";

  if (!variantIds.length) {
    return {
      estimate: null,
      diagnostics: {
        source: "cj-freight-calculate",
        attempted: false,
        reason: "missing-variant-id",
        startCountryCode,
      },
    };
  }

  let quotes: CjFreightCalculateQuote[] = [];
  try {
    quotes = await calculateCjFreight({
      startCountryCode,
      endCountryCode: "US",
      products: variantIds.map((vid) => ({ quantity: 1, vid })),
    });
  } catch (error) {
    return {
      estimate: null,
      diagnostics: {
        source: "cj-freight-calculate",
        attempted: false,
        reason: error instanceof Error && error.message.includes("missing CJ_API_KEY") ? "missing-auth" : "request-failed",
        startCountryCode,
        variantIds,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const selected = selectBestCjFreightQuote(quotes);
  if (!selected) {
    return {
      estimate: null,
      diagnostics: {
        source: "cj-freight-calculate",
        attempted: true,
        reason: "no-quotes",
        startCountryCode,
        variantIds,
        quoteCount: quotes.length,
      },
    };
  }

  const aging = parseDeliveryCycleDays(selected.logisticAging);
  const price = toPriceString(
    toFiniteNumber(selected.totalPostageFee) ?? toFiniteNumber(selected.logisticPrice)
  );

  return {
    estimate: {
      label: toNonEmptyString(selected.logisticName) ?? "CJ freight calculation",
      cost: price,
      currency: price ? "USD" : null,
      etaMinDays: aging.minDays,
      etaMaxDays: aging.maxDays,
      ship_from_country: startCountryCode,
    },
    diagnostics: {
      source: "cj-freight-calculate",
      attempted: true,
      startCountryCode,
      variantIds,
      quoteCount: quotes.length,
      selectedLogisticName: toNonEmptyString(selected.logisticName),
      selectedLogisticAging: toNonEmptyString(selected.logisticAging),
      selectedLogisticPrice: toFiniteNumber(selected.logisticPrice),
      selectedTotalPostageFee: toFiniteNumber(selected.totalPostageFee),
    },
  };
}

function buildCjSourceUrl(productId: string): string {
  return `https://www.cjdropshipping.com/product/-p-${productId}.html`;
}

function normalizeCjSearchVideoUrls(product: CjSearchProduct): string[] {
  return Array.from(new Set((Array.isArray(product.videoList) ? product.videoList : []).filter(Boolean))).slice(
    0,
    5
  );
}

function normalizeCjSearchVariants(product: CjSearchProduct): ProductVariant[] {
  return String(product.variantKeyEn ?? "")
    .split(/[;,/|]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((value) => ({ name: "option", value }));
}

function toAvailabilitySignal(product: CjSearchProduct): {
  signal: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  confidence: number;
} {
  const totalVerified = toFiniteNumber(product.totalVerifiedInventory);
  const totalInventory = toFiniteNumber(product.warehouseInventoryNum) ?? totalVerified;
  const saleStatus = String(product.saleStatus ?? "").trim();
  const authorityStatus = String(product.authorityStatus ?? "").trim();

  if (saleStatus && saleStatus !== "3") {
    return { signal: "OUT_OF_STOCK", confidence: 0.95 };
  }
  if (authorityStatus && authorityStatus !== "1") {
    return { signal: "OUT_OF_STOCK", confidence: 0.9 };
  }
  if (totalInventory == null) {
    return { signal: "UNKNOWN", confidence: 0.35 };
  }
  if (totalInventory <= 0) return { signal: "OUT_OF_STOCK", confidence: 0.95 };
  if (totalInventory < 10) return { signal: "LOW_STOCK", confidence: 0.85 };
  return { signal: "IN_STOCK", confidence: 0.95 };
}

function mapSearchProductToSupplierProduct(product: CjSearchProduct, keyword: string): SupplierProduct | null {
  const supplierProductId = toNonEmptyString(product.id);
  if (!supplierProductId) return null;

  const title = toNonEmptyString(product.nameEn);
  const primaryImage = toNonEmptyString(product.bigImage);
  const availability = toAvailabilitySignal(product);
  const videos = normalizeCjSearchVideoUrls(product);
  const price = toPriceString(
    toFiniteNumber(product.discountPrice) ?? toFiniteNumber(product.sellPrice)
  );
  const shippingEstimates = buildCjShippingEstimates(product);

  return {
    title,
    price,
    currency: "USD",
    images: primaryImage ? [primaryImage] : [],
    variants: normalizeCjSearchVariants(product),
    sourceUrl: buildCjSourceUrl(supplierProductId),
    supplierProductId,
    shippingEstimates,
    platform: "CJ Dropshipping",
    keyword,
    snapshotTs: new Date().toISOString(),
    availabilitySignal: availability.signal,
    availabilityConfidence: availability.confidence,
    snapshotQuality: primaryImage ? "HIGH" : "LOW",
    telemetrySignals: primaryImage ? ["parsed"] : ["parsed", "low_quality"],
    raw: {
      provider: "cj-list-v2",
      parseMode: "api",
      crawlStatus: "PARSED",
      listingValidity: "VALID",
      keyword,
      title,
      sourceUrl: buildCjSourceUrl(supplierProductId),
      supplierProductId,
      productId: supplierProductId,
      price,
      currency: "USD",
      categoryId: product.categoryId ?? null,
      categoryName: product.threeCategoryName ?? null,
      categoryPath: [product.oneCategoryName, product.twoCategoryName, product.threeCategoryName].filter(Boolean),
      description: toNonEmptyString(product.description),
      deliveryCycle: toNonEmptyString(product.deliveryCycle),
      inventoryBadge: toFiniteNumber(product.warehouseInventoryNum),
      listedNum: toFiniteNumber(product.listedNum),
      verifiedWarehouse: toFiniteNumber(product.verifiedWarehouse),
      totalVerifiedInventory: toFiniteNumber(product.totalVerifiedInventory),
      totalUnVerifiedInventory: toFiniteNumber(product.totalUnVerifiedInventory),
      warehouseInventoryNum: toFiniteNumber(product.warehouseInventoryNum),
      saleStatus: product.saleStatus ?? null,
      authorityStatus: product.authorityStatus ?? null,
      supplierName: toNonEmptyString(product.supplierName),
      hasCECertification: toFiniteNumber(product.hasCECertification),
      customization: toFiniteNumber(product.customization),
      isPersonalized: toFiniteNumber(product.isPersonalized),
      variantKeyEn: toNonEmptyString(product.variantKeyEn),
      availabilitySignal: availability.signal,
      availabilityConfidence: availability.confidence,
      availabilityEvidencePresent: toFiniteNumber(product.warehouseInventoryNum) != null,
      availabilityEvidenceQuality: "HIGH",
      videos,
      sku: null,
      variantMapping: normalizeCjSearchVariants(product).map((variant) => ({
        sku: null,
        variantKey: variant.value,
        optionValues: [variant.value],
      })),
      telemetrySignals: primaryImage ? ["parsed"] : ["parsed", "low_quality"],
      cjProofState: buildCjProofStateSnapshot({
        hasProductEvidence: true,
        hasVariantEvidence: normalizeCjSearchVariants(product).length > 0,
        hasStockEvidence: toFiniteNumber(product.warehouseInventoryNum) != null,
        hasFreightEvidence: shippingEstimates.length > 0,
      }),
    },
  };
}

export async function searchCjByKeyword(keyword: string, limit = 20): Promise<SupplierProduct[]> {
  const trimmedKeyword = String(keyword ?? "").trim();
  if (!trimmedKeyword) return [];

  const pageSize = Math.max(1, Math.min(Number(limit) || 20, 100));
  const countryCode = String(process.env.CJ_DISCOVER_COUNTRY_CODE ?? "US").trim() || "US";
  const startWarehouseInventory = Math.max(1, Number(process.env.CJ_DISCOVER_MIN_INVENTORY ?? 10));
  const search = await searchCjProducts({
    keyword: trimmedKeyword,
    size: pageSize,
    countryCode,
    startWarehouseInventory,
  });
  if (!search.wrapped) return [];

  const products = search.products;
  const mappedProducts = products
    .map((product) => mapSearchProductToSupplierProduct(product, trimmedKeyword))
    .filter((product): product is SupplierProduct => product != null)
    .slice(0, pageSize)
    .map((product) => ({
      ...product,
      raw: {
        ...product.raw,
        searchQuery: {
          keyword: trimmedKeyword,
          countryCode,
          startWarehouseInventory,
          pageSize,
        },
        apiResponseCode: search.wrapped?.code ?? null,
        apiResponseMessage: search.wrapped?.message ?? null,
        resultCount: products.length,
        pageSize,
      },
    }));

  if (!mappedProducts.length) {
    console.info(
      JSON.stringify({
        supplier: "cjdropshipping",
        event: "CJ_SEARCH_NO_RESULTS",
        keyword: trimmedKeyword,
        countryCode,
        startWarehouseInventory,
        apiResponseCode: search.wrapped?.code ?? null,
        apiResponseMessage: search.wrapped?.message ?? null,
        resultCount: products.length,
        pageSize,
      })
    );
  }

  return mappedProducts;
}

export async function fetchCjDirectProduct(sourceUrl: string): Promise<CjDirectProductResult> {
  const supplierProductId = parseCjProductIdFromUrl(sourceUrl);
  if (!supplierProductId) {
    throw new Error("Unable to parse CJ product id from source URL");
  }

  const { detailCacheUrl, inventoryCacheUrl, detailWrapped, inventoryWrapped } =
    await getCjDirectProductSnapshot(supplierProductId);

  const detail = detailWrapped.data;
  if (!detail?.ID) {
    throw new Error(`CJ product detail missing data for ${supplierProductId}`);
  }

  const inventory = inventoryWrapped.data ?? {};
  const inventories = Array.isArray(inventory.inventories) ? inventory.inventories : [];
  const variantInventories = Array.isArray(inventory.variantInventories) ? inventory.variantInventories : [];
  const priceRange = parsePriceRange(detail.SELLPRICE);
  const variantPriceRange = (Array.isArray(detail.stanProducts) ? detail.stanProducts : []).reduce(
    (acc, variant) => {
      const parsed = parsePriceRange(variant.SELLPRICE);
      const min = parsed.min != null ? (acc.min == null ? parsed.min : Math.min(acc.min, parsed.min)) : acc.min;
      const max = parsed.max != null ? (acc.max == null ? parsed.max : Math.max(acc.max, parsed.max)) : acc.max;
      return { min, max };
    },
    { min: priceRange.min, max: priceRange.max } as { min: number | null; max: number | null }
  );

  const verifiedInventory = sumInventoryValues(inventories, "realInventoryNum");
  const totalInventory =
    sumInventoryValues(inventories, "inventoryNum") || sumVariantInventories(variantInventories);
  const stockCount = totalInventory > 0 ? totalInventory : verifiedInventory > 0 ? verifiedInventory : null;
  const availabilitySignal = stockCount != null && stockCount > 0 ? "IN_STOCK" : "OUT_OF_STOCK";
  const availabilityConfidence = stockCount != null ? 0.98 : 0.85;
  const inventoryEvidenceText = buildInventoryEvidenceText(inventories);
  const images = normalizeImageUrls(detail);
  const priceMin = toPriceString(variantPriceRange.min);
  const priceMax = toPriceString(variantPriceRange.max);
  const scanPrice = priceMax ?? priceMin;
  const rawTitle = toNonEmptyString(detail.NAMEEN) ?? toNonEmptyString(detail.NAME);
  const title = looksLikeCorruptedTitle(rawTitle)
    ? parseTitleFromCjSourceUrl(sourceUrl) ?? rawTitle
    : rawTitle;
  const warehouseCountry =
    toNonEmptyString(inventories[0]?.countryCode) ?? toNonEmptyString(inventories[0]?.countryNameEn);
  const detailShippingEvidence = buildCjDetailShippingEvidence(detail, warehouseCountry);
  const freightTrialTip =
    detailShippingEvidence.signal === "PRESENT"
      ? null
      : await fetchCjFreightTrialEstimateTip({ detail, warehouseCountry });
  const freightTrialFallback =
    detailShippingEvidence.signal === "PRESENT" || freightTrialTip?.estimate != null
      ? null
      : await fetchCjFreightTrialEstimate({ detail, warehouseCountry });
  const freightTrial = freightTrialTip?.estimate != null ? freightTrialTip : freightTrialFallback;
  const freightTrialEstimate = freightTrial?.estimate ?? null;
  const freightEvidenceSource =
    freightTrialEstimate != null
      ? String(freightTrial?.diagnostics?.source ?? "cj-freight-calculate")
      : null;
  const shippingEvidence =
    freightTrialEstimate != null
      ? {
          estimates: [freightTrialEstimate],
          signal:
            freightTrialEstimate.cost != null ||
            freightTrialEstimate.etaMinDays != null ||
            freightTrialEstimate.etaMaxDays != null
              ? "PRESENT"
              : "PARTIAL",
          evidenceText: freightTrialEstimate.label ?? "CJ freight calculation",
          shipFromCountry: freightTrialEstimate.ship_from_country ?? warehouseCountry,
          shippingConfidence:
            freightTrialEstimate.cost != null &&
            (freightTrialEstimate.etaMinDays != null || freightTrialEstimate.etaMaxDays != null)
              ? 0.96
              : 0.88,
        }
      : detailShippingEvidence;
  const shippingOriginEvidenceSource = shippingEvidence.shipFromCountry
    ? warehouseCountry
      ? "warehouse_inventory"
      : freightEvidenceSource ?? "detail_shipping_text"
    : null;
  const shippingTrialDiagnostics =
    freightTrialTip != null && freightTrialFallback != null
      ? {
          tip: freightTrialTip.diagnostics,
          fallback: freightTrialFallback.diagnostics,
          selectedSource: freightEvidenceSource,
        }
      : freightTrial?.diagnostics ?? freightTrialTip?.diagnostics ?? null;
  const variantMapping = buildCjVariantMapping(detail.stanProducts);
  const videoUrls = normalizeVideoUrls(detail);
  const mediaQualityScore = computeCjMediaQualityScore(images.length, videoUrls.length);

  const product: SupplierProduct = {
    title,
    price: scanPrice,
    currency: "USD",
    images,
    variants: normalizeVariants(detail),
    sourceUrl,
    supplierProductId,
    shippingEstimates: shippingEvidence.estimates,
    platform: "CJ Dropshipping",
    keyword: title ?? supplierProductId,
    snapshotTs: new Date().toISOString(),
    availabilitySignal,
    availabilityConfidence,
    snapshotQuality: "HIGH",
    telemetrySignals: ["parsed"],
    raw: {
      provider: "cj-direct-product-cache",
      parseMode: "direct-product-cache",
      crawlStatus: "PARSED",
      listingValidity: "VALID",
      detailCacheUrl,
      inventoryCacheUrl,
      sourceUrl,
      sourceType: "direct-product-page",
      supplierProductId,
      title,
      rawTitle,
      price: scanPrice,
      priceMin,
      priceMax,
      currency: "USD",
      sku: toNonEmptyString(detail.SKU),
      variantMapping,
      availabilitySignal,
      availabilityConfidence,
      availabilityEvidencePresent: stockCount != null,
      availabilityEvidenceQuality: "HIGH",
      availabilityEvidenceText: inventoryEvidenceText,
      inventoryBadge: inventoryEvidenceText,
      stockCount,
      verifiedInventory,
      totalInventory: stockCount,
      warehouseCount: inventories.length,
      supplierWarehouseCountry: warehouseCountry,
      shipFromCountry: shippingEvidence.shipFromCountry,
      ship_from_country: shippingEvidence.shipFromCountry,
      shipFromLocation: shippingEvidence.shipFromCountry ? `${shippingEvidence.shipFromCountry} warehouse` : null,
      ship_from_location: shippingEvidence.shipFromCountry ? `${shippingEvidence.shipFromCountry} warehouse` : null,
      shippingOriginEvidenceSource,
      shippingEvidenceSource:
        freightTrialEstimate != null
          ? freightEvidenceSource
          : detailShippingEvidence.evidenceText
            ? "detail_shipping_text"
            : null,
      shippingConfidence: shippingEvidence.shippingConfidence,
      shippingSignal: shippingEvidence.signal,
      shippingTransparencyState:
        shippingEvidence.signal === "PRESENT"
          ? "PRESENT"
          : shippingEvidence.signal === "PARTIAL"
            ? "INCOMPLETE"
            : "MISSING",
      shippingEvidenceText: shippingEvidence.evidenceText,
      shipping:
        shippingEvidence.estimates.length > 0
          ? {
              summary: shippingEvidence.evidenceText,
              options: shippingEvidence.estimates.map((estimate) => ({
                label: estimate.label ?? null,
                cost: estimate.cost ?? null,
                currency: estimate.currency ?? null,
                etaMinDays: estimate.etaMinDays ?? null,
                etaMaxDays: estimate.etaMaxDays ?? null,
                shipFromCountry: estimate.ship_from_country ?? shippingEvidence.shipFromCountry,
                destinationCountry: "US",
              })),
            }
          : null,
      evidenceSource: "api_detail",
      detailQuality: "HIGH",
      enrichmentQuality: shippingEvidence.signal === "PRESENT" ? "HIGH" : shippingEvidence.signal === "PARTIAL" ? "MEDIUM" : "LOW",
      verifiedWarehouse: toFiniteNumber(detail.verifiedWarehouse),
      saleStatus: String(detail.saleStatus ?? ""),
      updatePriceDate: String(detail.updatePriceDate ?? ""),
      propertyEn: toNonEmptyString(detail.PROPERTYEN),
      variantKeyEn: toNonEmptyString(detail.VARIANTKEYEN),
      goodsJsonSearch: detail.goodsJsonSearch ?? null,
      cjProofState: buildCjProofStateSnapshot({
        hasProductEvidence: true,
        hasVariantEvidence: variantMapping.length > 0,
        hasStockEvidence: stockCount != null,
        hasFreightEvidence: shippingEvidence.estimates.length > 0,
      }),
      videos: videoUrls,
      videoUrls,
      videoCount: videoUrls.length,
      mediaQualityScore,
      media: {
        images,
        imageCount: images.length,
        videoUrls,
        videoCount: videoUrls.length,
        present: images.length > 0 || videoUrls.length > 0,
        qualityScore: mediaQualityScore,
      },
      sourceFrom: detail.sourceFrom ?? null,
      stanProducts: Array.isArray(detail.stanProducts) ? detail.stanProducts.slice(0, 20) : [],
      detailPayload: detail,
      inventoryPayload: inventory,
      shippingTrialDiagnostics,
      snapshotQuality: "HIGH",
      telemetrySignals: ["parsed"],
    },
  };

  return {
    product,
    priceMin,
    priceMax,
    stockCount,
    inventoryEvidenceText,
    detailCacheUrl,
    inventoryCacheUrl,
  };
}
