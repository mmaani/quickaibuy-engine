export type ListingPreviewMarketplace = "ebay" | "amazon";

export type ListingPreviewInput = {
  candidateId: string;

  supplierKey: string;
  supplierProductId: string;
  supplierTitle: string | null;
  supplierSourceUrl: string | null;
  supplierImageUrl: string | null;
  supplierPrice: number | null;
  supplierWarehouseCountry: string | null;
  shipFromCountry: string | null;

  marketplaceKey: string;
  marketplaceListingId: string;
  marketplaceTitle: string | null;
  marketplacePrice: number | null;

  estimatedProfit: number | null;
  marginPct: number | null;
  roiPct: number | null;
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
  source: {
    candidateId: string;
    supplierKey: string;
    supplierProductId: string;
    supplierTitle: string | null;
    supplierSourceUrl: string | null;
    supplierImageUrl: string | null;
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
};

export type ListingPreviewOutput = {
  marketplaceKey: ListingPreviewMarketplace;
  title: string;
  price: number;
  quantity: number;
  payload: Record<string, unknown>;
  response?: Record<string, unknown>;
};
