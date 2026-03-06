export type ShippingEstimate = {
  label?: string;
  cost?: string | null;
  currency?: string | null;
  etaMinDays?: number | null;
  etaMaxDays?: number | null;
};

export type ProductVariant = {
  name: string;
  value: string;
};

export type SupplierPlatform = "AliExpress" | "Alibaba" | "Temu";

export type SupplierProduct = {
  title: string | null;
  price: string | null;
  currency: string | null;
  images: string[];
  variants: ProductVariant[];
  sourceUrl: string;
  supplierProductId: string | null;
  shippingEstimates: ShippingEstimate[];
  platform: SupplierPlatform;
  keyword: string;
  snapshotTs: string;
  raw: Record<string, unknown>;
};
