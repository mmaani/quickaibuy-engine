export type ShippingEstimate = {
  label?: string;
  cost?: string | null;
  currency?: string | null;
  etaMinDays?: number | null;
  etaMaxDays?: number | null;
};

export type SupplierSnapshotQuality = "HIGH" | "MEDIUM" | "LOW" | "STUB";
export type SupplierTelemetrySignal = "parsed" | "fallback" | "challenge" | "low_quality";

export type ProductVariant = {
  name: string;
  value: string;
};

export type SupplierPlatform = "AliExpress" | "Alibaba" | "Temu" | "CJ Dropshipping";

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
  availabilitySignal?: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  availabilityConfidence?: number | null;
  snapshotQuality?: SupplierSnapshotQuality;
  telemetrySignals?: SupplierTelemetrySignal[];
  raw: Record<string, unknown>;
};
