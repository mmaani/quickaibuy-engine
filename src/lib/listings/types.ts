export type ListingPreviewMarketplace = "ebay" | "amazon";

export type ListingPreviewMediaImageKind = "hero" | "angle" | "lifestyle" | "detail" | "other";
export type ListingPreviewMediaHostingMode = "external" | "self_hosted" | "eps";

export type ListingPreviewMediaImage = {
  url: string;
  kind: ListingPreviewMediaImageKind;
  rank: number;
  source: "supplier" | "marketplace";
  fingerprint: string;
  hostingMode: ListingPreviewMediaHostingMode;
  reasons: string[];
};

export type ListingPreviewMediaVideo = {
  url: string;
  format: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  validationOk: boolean;
  validationReason: string | null;
  attachOnPublish: boolean;
  publishSupported: boolean;
  operatorNote: string | null;
};

export type ListingPreviewMediaAudit = {
  imageCandidateCount: number;
  imageSelectedCount: number;
  imageSkippedCount: number;
  imageQualityEligibleCount?: number;
  imageHostingMode: ListingPreviewMediaHostingMode | null;
  mixedImageHostingModesDropped: boolean;
  selectedImageUrls: string[];
  selectedImageKinds?: string[];
  selectedImageSlots?: string[];
  imageNormalization?: Record<string, unknown> | null;
  imageHostingValidation?: Record<string, unknown> | null;
  videoDetected: boolean;
  videoAttached: boolean;
  videoSkipped: boolean;
  videoSkipReason: string | null;
  operatorNote: string | null;
};

export type ListingPreviewMedia = {
  images: ListingPreviewMediaImage[];
  video: ListingPreviewMediaVideo | null;
  audit: ListingPreviewMediaAudit;
};

export type ListingPreviewInput = {
  candidateId: string;

  supplierKey: string;
  supplierProductId: string;
  supplierTitle: string | null;
  supplierSourceUrl: string | null;
  supplierImageUrl: string | null;
  supplierImages?: string[] | null;
  supplierPrice: number | null;
  supplierRawPayload?: unknown;
  supplierWarehouseCountry: string | null;
  shipFromCountry: string | null;
  marketplaceImageUrl: string | null;

  marketplaceKey: string;
  marketplaceListingId: string;
  marketplaceTitle: string | null;
  marketplaceRawPayload?: unknown;
  marketplacePrice: number | null;

  estimatedProfit: number | null;
  marginPct: number | null;
  roiPct: number | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryConfidence?: number | null;
  categoryRuleLabel?: string | null;
};

export type EbayListingPreviewPayload = {
  dryRun: true;
  marketplace: "ebay";
  listingType: "fixed_price";
  title: string;
  price: number;
  quantity: number;
  condition: "NEW";
  shipFromCountry: string | null;
  handlingDaysMin?: number | null;
  handlingDaysMax?: number | null;
  shippingDaysMin?: number | null;
  shippingDaysMax?: number | null;
  images?: string[];
  media?: ListingPreviewMedia;
  description?: string | null;
  source: {
    candidateId: string;
    supplierKey: string;
    supplierProductId: string;
    supplierTitle: string | null;
    supplierSourceUrl: string | null;
    supplierImageUrl: string | null;
    supplierImages?: string[];
    supplierWarehouseCountry: string | null;
    shipFromCountry: string | null;
  };
  matchedMarketplace: {
    marketplaceKey: string;
    marketplaceListingId: string;
    marketplaceTitle: string | null;
    marketplacePrice: number | null;
  };
  economics: {
    estimatedProfit: number | null;
    marginPct: number | null;
    roiPct: number | null;
  };
  categoryId?: string | null;
  categoryConfidence?: number | null;
  categoryRuleLabel?: string | null;
  itemSpecifics?: Record<string, string | null>;
  pricingHint?: string | null;
  trustFlags?: string[];
};

export type ListingPreviewOutput = {
  marketplaceKey: ListingPreviewMarketplace;
  title: string;
  price: number;
  quantity: number;
  payload: Record<string, unknown>;
  response?: Record<string, unknown>;
};
