export type ListingPreviewMarketplace = "ebay" | "amazon";

export type ListingPreviewInput = {
  candidateId: string;

  supplierKey: string;
  supplierProductId: string;
  supplierTitle: string | null;
  supplierSourceUrl: string | null;
  supplierImageUrl: string | null;
  supplierPrice: number | null;

  marketplaceKey: string;
  marketplaceListingId: string;
  marketplaceTitle: string | null;
  marketplacePrice: number | null;

  estimatedProfit: number | null;
  marginPct: number | null;
  roiPct: number | null;
};

export type ListingPreviewOutput = {
  marketplaceKey: ListingPreviewMarketplace;
  title: string;
  price: number;
  quantity: number;
  payload: Record<string, unknown>;
  response?: Record<string, unknown>;
};
