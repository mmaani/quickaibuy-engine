export const JOBS_QUEUE_NAME = "jobs";

export const JOB_NAMES = {
  TREND_EXPAND: "trend:expand",
  PRODUCT_DISCOVER: "product:discover",
  SUPPLIER_DISCOVER: "supplier:discover",

  SCAN_SUPPLIER: "SCAN_SUPPLIER",
  SCAN_MARKETPLACE_PRICE: "SCAN_MARKETPLACE_PRICE",
  MATCH_PRODUCT: "MATCH_PRODUCT",
  EVAL_PROFIT: "EVAL_PROFIT",
  CREATE_LISTING: "CREATE_LISTING",
  ORDER_SYNC: "ORDER_SYNC",
} as const;

export const LEGACY_JOB_NAMES = {
  SCAN_MARKETPLACE_PRICE: "marketplace:scan",
  MATCH_PRODUCT: "match:product",
} as const;

export const JOBS = JOB_NAMES;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
export type LegacyJobName = (typeof LEGACY_JOB_NAMES)[keyof typeof LEGACY_JOB_NAMES];
