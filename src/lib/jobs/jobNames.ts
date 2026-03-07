import { BULL_PREFIX, JOB_NAMES as ROOT_JOB_NAMES, JOBS_QUEUE_NAME } from "../jobNames";

export { JOBS_QUEUE_NAME };
export { BULL_PREFIX };

export const JOB_NAMES = ROOT_JOB_NAMES;

export const LEGACY_JOB_NAMES = {
  SCAN_MARKETPLACE_PRICE: "marketplace:scan",
  MATCH_PRODUCT: "match:product",
  PRODUCT_MATCH: "product:match",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
export type LegacyJobName = (typeof LEGACY_JOB_NAMES)[keyof typeof LEGACY_JOB_NAMES];
