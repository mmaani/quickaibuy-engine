export type TrendIngestJob = {
  source: "manual";
  signalType: "keyword";
  signalValue: string;
  region?: string;
  score?: number;
  rawPayload?: unknown;
};

export type SupplierDiscoverJob = {
  limitPerKeyword?: number;
};

export type MarketplaceScanJob = {
  limit?: number;
  productRawId?: string;
  platform?: "amazon" | "ebay" | "all";
};

export type MatchProductJob = {
  supplierLimit?: number;
  marketplaceLimit?: number;
  minConfidence?: number;
};

export type ProfitEvalJob = {
  limit?: number;
};
