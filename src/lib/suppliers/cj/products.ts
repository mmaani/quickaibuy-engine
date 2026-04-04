import { cjRequest } from "./client";

export type CjSearchProduct = {
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

type CjSearchResponse = {
  content?: Array<{
    productList?: CjSearchProduct[];
  }>;
};

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
