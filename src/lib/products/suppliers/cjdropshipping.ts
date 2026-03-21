import type { ProductVariant, SupplierProduct } from "./types";

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
};

type CjWrappedResponse<T> = {
  code?: number;
  data?: T;
  message?: string;
  success?: boolean;
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

  return Array.from(new Set(withPrimary)).slice(0, 8);
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
  const match = raw.match(/-p-([A-Z0-9-]{20,})\.html/i);
  return match?.[1]?.toUpperCase() ?? null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`CJ fetch failed: ${res.status} ${url}`);
  }

  return (await res.json()) as T;
}

export async function fetchCjDirectProduct(sourceUrl: string): Promise<CjDirectProductResult> {
  const supplierProductId = parseCjProductIdFromUrl(sourceUrl);
  if (!supplierProductId) {
    throw new Error("Unable to parse CJ product id from source URL");
  }

  const detailCacheUrl = `https://cache.cjdropshipping.com/productDetail/${supplierProductId}.json`;
  const inventoryCacheUrl = `https://cache.cjdropshipping.com/inventory/${supplierProductId}.json`;

  const detailWrapped = await fetchJson<CjWrappedResponse<CjProductDetailData>>(detailCacheUrl);
  const inventoryWrapped = await fetchJson<
    CjWrappedResponse<{ inventories?: CjInventoryEntry[]; variantInventories?: CjVariantInventory[] }>
  >(inventoryCacheUrl);

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
  const title = toNonEmptyString(detail.NAMEEN) ?? toNonEmptyString(detail.NAME);

  const product: SupplierProduct = {
    title,
    price: scanPrice,
    currency: "USD",
    images,
    variants: normalizeVariants(detail),
    sourceUrl,
    supplierProductId,
    shippingEstimates: [],
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
      price: scanPrice,
      priceMin,
      priceMax,
      currency: "USD",
      sku: toNonEmptyString(detail.SKU),
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
      supplierWarehouseCountry:
        toNonEmptyString(inventories[0]?.countryCode) ?? toNonEmptyString(inventories[0]?.countryNameEn),
      verifiedWarehouse: toFiniteNumber(detail.verifiedWarehouse),
      saleStatus: String(detail.saleStatus ?? ""),
      updatePriceDate: String(detail.updatePriceDate ?? ""),
      propertyEn: toNonEmptyString(detail.PROPERTYEN),
      variantKeyEn: toNonEmptyString(detail.VARIANTKEYEN),
      goodsJsonSearch: detail.goodsJsonSearch ?? null,
      sourceFrom: detail.sourceFrom ?? null,
      stanProducts: Array.isArray(detail.stanProducts) ? detail.stanProducts.slice(0, 20) : [],
      detailPayload: detail,
      inventoryPayload: inventory,
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
