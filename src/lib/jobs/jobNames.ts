export const JOB_NAMES = {
  TREND_EXPAND: "trend:expand",
  PRODUCT_DISCOVER: "product:discover",
} as const;

export type JobName = typeof JOB_NAMES[keyof typeof JOB_NAMES];
