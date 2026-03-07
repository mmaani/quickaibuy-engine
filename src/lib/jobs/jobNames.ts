export const JOB_NAMES = {
  TREND_EXPAND: "trend:expand",
  PRODUCT_DISCOVER: "product:discover",
  SUPPLIER_DISCOVER: "supplier:discover",
  SCAN_MARKETPLACE_PRICE: "SCAN_MARKETPLACE_PRICE",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
