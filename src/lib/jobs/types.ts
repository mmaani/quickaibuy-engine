export type TrendIngestJob = {
  source: "manual";
  signalType: "keyword";
  signalValue: string;
  region?: string;
  score?: number;
  rawPayload?: unknown;
};
