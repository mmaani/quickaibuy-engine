import { cjRequest } from "./client";

export type CjSearchProduct = {
  id?: string;
  sku?: string;
  spu?: string;
  nameEn?: string;
  bigImage?: string;
  sellPrice?: string | number;
  nowPrice?: string | number;
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
  productType?: string;
  createAt?: number | string;
};

export type CjSearchResponse = {
  pageSize?: number | string;
  pageNumber?: number | string;
  totalRecords?: number | string;
  totalPages?: number | string;
  content?: Array<{
    productList?: CjSearchProduct[];
    keyWord?: string;
    keyWordOld?: string;
    relatedCategoryList?: Array<{ categoryId?: string; categoryName?: string }>;
  }>;
};

export type CjInventoryEntry = {
  areaEn?: string;
  countryCode?: string;
  countryNameEn?: string;
  inventoryNum?: number | string;
  realInventoryNum?: number | string;
  cjInventoryNum?: number | string;
  factoryInventoryNum?: number | string;
};

export type CjVariantInventory = {
  vid?: string;
  inventory?: Array<{
    totalInventory?: number | string;
    cjInventory?: number | string;
    factoryInventory?: number | string;
    countryCode?: string;
  }>;
};

export type CjStanProduct = {
  ID?: string;
  IMG?: string;
  NAMEEN?: string;
  SELLPRICE?: string | number;
  SKU?: string;
  VARIANTKEY?: string;
  expandField?: string;
};

export type CjProductDetailData = {
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

export type CjVariantRecord = Record<string, unknown>;
export type CjStockRecord = Record<string, unknown>;
export type CjCategoryRecord = Record<string, unknown>;
export type CjWarehouseRecord = Record<string, unknown>;

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanArray(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(cleanString(value)))));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`CJ fetch failed: ${response.status} ${url}`);
  }

  return (await response.json()) as T;
}

export async function searchCjProducts(input: {
  keyword: string;
  size: number;
  countryCode: string;
  startWarehouseInventory: number;
}) {
  const wrapped = await cjRequest<CjSearchResponse>({
    method: "GET",
    path: "/product/listV2",
    operation: "cj.products.listV2",
    query: {
      page: 1,
      size: input.size,
      keyWord: input.keyword,
      countryCode: input.countryCode,
      verifiedWarehouse: 1,
      startWarehouseInventory: input.startWarehouseInventory,
      orderBy: 4,
      sort: "desc",
      features: "enable_description,enable_category,enable_video",
    },
    allowMissingAuth: true,
    cacheTtlMs: 60_000,
  });

  return {
    wrapped,
    products:
      Array.isArray(wrapped?.data?.content)
        ? wrapped.data.content.flatMap((entry) => (Array.isArray(entry.productList) ? entry.productList : []))
        : [],
  };
}

export async function listCjProducts(input?: {
  pageNum?: number;
  pageSize?: number;
  categoryId?: string | null;
  pid?: string | null;
  productSku?: string | null;
  productName?: string | null;
  productNameEn?: string | null;
  countryCode?: string | null;
  verifiedWarehouse?: number | null;
  startInventory?: number | null;
  endInventory?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minListedNum?: number | null;
  maxListedNum?: number | null;
  sort?: "asc" | "desc" | null;
  orderBy?: "createAt" | "listedNum" | null;
  deliveryTime?: string | null;
}) {
  return cjRequest<Record<string, unknown>>({
    method: "GET",
    path: "/product/list",
    operation: "cj.products.list",
    query: {
      pageNum: input?.pageNum ?? 1,
      pageSize: input?.pageSize ?? 20,
      categoryId: cleanString(input?.categoryId),
      pid: cleanString(input?.pid),
      productSku: cleanString(input?.productSku),
      productName: cleanString(input?.productName),
      productNameEn: cleanString(input?.productNameEn),
      countryCode: cleanString(input?.countryCode),
      verifiedWarehouse: input?.verifiedWarehouse ?? undefined,
      startInventory: input?.startInventory ?? undefined,
      endInventory: input?.endInventory ?? undefined,
      minPrice: input?.minPrice ?? undefined,
      maxPrice: input?.maxPrice ?? undefined,
      minListedNum: input?.minListedNum ?? undefined,
      maxListedNum: input?.maxListedNum ?? undefined,
      sort: cleanString(input?.sort),
      orderBy: cleanString(input?.orderBy),
      deliveryTime: cleanString(input?.deliveryTime),
    },
    cacheTtlMs: 60_000,
  });
}

export async function queryCjProductById(pid: string) {
  const trimmed = cleanString(pid);
  if (!trimmed) throw new Error("CJ product validation failed: pid is required");
  const wrapped = await cjRequest<CjProductDetailData>({
    method: "GET",
    path: "/product/query",
    operation: "cj.products.query",
    query: { pid: trimmed },
    cacheTtlMs: 60_000,
  });
  return (wrapped?.data ?? null) as CjProductDetailData | null;
}

export async function queryCjVariantsByPid(pid: string): Promise<CjVariantRecord[]> {
  const trimmed = cleanString(pid);
  if (!trimmed) throw new Error("CJ variant validation failed: pid is required");
  const wrapped = await cjRequest<CjVariantRecord[] | { variants?: CjVariantRecord[] }>({
    method: "GET",
    path: "/product/variant/query",
    operation: "cj.products.variant.query",
    query: { pid: trimmed },
    cacheTtlMs: 60_000,
  });
  const data = wrapped?.data;
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.variants) ? data.variants : [];
}

export async function queryCjVariantByVid(vid: string): Promise<CjVariantRecord | null> {
  const trimmed = cleanString(vid);
  if (!trimmed) throw new Error("CJ variant validation failed: vid is required");
  const wrapped = await cjRequest<CjVariantRecord | CjVariantRecord[]>({
    method: "GET",
    path: "/product/variant/queryByVid",
    operation: "cj.products.variant.queryByVid",
    query: { vid: trimmed },
    cacheTtlMs: 60_000,
  });
  const data = wrapped?.data;
  if (Array.isArray(data)) return data[0] ?? null;
  return (data ?? null) as CjVariantRecord | null;
}

export async function queryCjStockByVid(vid: string): Promise<CjStockRecord | null> {
  const trimmed = cleanString(vid);
  if (!trimmed) throw new Error("CJ stock validation failed: vid is required");
  const wrapped = await cjRequest<CjStockRecord | CjStockRecord[]>({
    method: "GET",
    path: "/product/stock/queryByVid",
    operation: "cj.products.stock.queryByVid",
    query: { vid: trimmed },
    cacheTtlMs: 30_000,
  });
  const data = wrapped?.data;
  if (Array.isArray(data)) return data[0] ?? null;
  return (data ?? null) as CjStockRecord | null;
}

export async function getCjProductCategories(): Promise<CjCategoryRecord[]> {
  const wrapped = await cjRequest<CjCategoryRecord[]>({
    method: "GET",
    path: "/product/getCategory",
    operation: "cj.products.getCategory",
    cacheTtlMs: 5 * 60_000,
  });
  return Array.isArray(wrapped?.data) ? wrapped.data : [];
}

export async function getCjGlobalWarehouses(): Promise<CjWarehouseRecord[]> {
  const wrapped = await cjRequest<CjWarehouseRecord[]>({
    method: "GET",
    path: "/product/globalWarehouseList",
    operation: "cj.products.globalWarehouseList",
    cacheTtlMs: 5 * 60_000,
  });
  return Array.isArray(wrapped?.data) ? wrapped.data : [];
}

export async function getCjReceiverCountryInfo(): Promise<Record<string, unknown>[] | null> {
  const wrapped = await cjRequest<Record<string, unknown>[]>({
    method: "GET",
    path: "/product/listed/getReceiverCountryInfo",
    operation: "cj.products.listed.getReceiverCountryInfo",
    cacheTtlMs: 5 * 60_000,
  });
  return Array.isArray(wrapped?.data) ? wrapped.data : null;
}

export async function getCjPlatformCategoryTree(platform: string): Promise<Record<string, unknown>[] | null> {
  const trimmed = cleanString(platform);
  if (!trimmed) throw new Error("CJ listed category validation failed: platform is required");
  const wrapped = await cjRequest<Record<string, unknown>[]>({
    method: "GET",
    path: "/product/listed/getPlatformCategoryTree",
    operation: "cj.products.listed.getPlatformCategoryTree",
    query: { platform: trimmed },
    cacheTtlMs: 5 * 60_000,
  });
  return Array.isArray(wrapped?.data) ? wrapped.data : null;
}

export async function getCjDeliveryProfiles(platform: string): Promise<Record<string, unknown>[] | null> {
  const trimmed = cleanString(platform);
  if (!trimmed) throw new Error("CJ delivery profile validation failed: platform is required");
  const wrapped = await cjRequest<Record<string, unknown>[]>({
    method: "GET",
    path: "/product/listed/queryDeliveryProfiles",
    operation: "cj.products.listed.queryDeliveryProfiles",
    query: { platform: trimmed },
    cacheTtlMs: 60_000,
  });
  return Array.isArray(wrapped?.data) ? wrapped.data : null;
}

export async function getCjVendors(): Promise<Record<string, unknown>[] | null> {
  const wrapped = await cjRequest<Record<string, unknown>[]>({
    method: "GET",
    path: "/product/listed/queryVendors",
    operation: "cj.products.listed.queryVendors",
    cacheTtlMs: 60_000,
  });
  return Array.isArray(wrapped?.data) ? wrapped.data : null;
}

export async function getCjListedByPids(pids: string[]): Promise<Record<string, unknown>[] | null> {
  const normalized = cleanArray(pids.map((value) => cleanString(value)));
  if (!normalized.length) throw new Error("CJ listed products validation failed: at least one pid is required");
  const wrapped = await cjRequest<Record<string, unknown>[]>({
    method: "POST",
    path: "/product/listed/listedByPids",
    operation: "cj.products.listed.listedByPids",
    body: normalized,
    cacheTtlMs: 60_000,
  });
  return Array.isArray(wrapped?.data) ? wrapped.data : null;
}

export async function getCjDirectProductSnapshot(productId: string): Promise<{
  detailCacheUrl: string;
  inventoryCacheUrl: string;
  detailWrapped: { data?: CjProductDetailData };
  inventoryWrapped: { data?: { inventories?: CjInventoryEntry[]; variantInventories?: CjVariantInventory[] } };
}> {
  const trimmed = cleanString(productId);
  if (!trimmed) throw new Error("CJ direct product validation failed: productId is required");

  const detailCacheUrl = `https://cache.cjdropshipping.com/productDetail/${trimmed}.json`;
  const inventoryCacheUrl = `https://cache.cjdropshipping.com/inventory/${trimmed}.json`;

  const [detailWrapped, inventoryWrapped] = await Promise.all([
    fetchJson<{ data?: CjProductDetailData }>(detailCacheUrl),
    fetchJson<{ data?: { inventories?: CjInventoryEntry[]; variantInventories?: CjVariantInventory[] } }>(inventoryCacheUrl),
  ]);

  return {
    detailCacheUrl,
    inventoryCacheUrl,
    detailWrapped,
    inventoryWrapped,
  };
}
