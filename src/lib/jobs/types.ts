export type TrendIngestJob = {
  source: "manual";
  signalType: "keyword";
  signalValue: string;
  region?: string;
  score?: number;
  rawPayload?: unknown;
};

export type MarketplaceScanJob = {
  limit?: number;
  productRawId?: string;
  platform?: "amazon" | "ebay" | "all";
};
