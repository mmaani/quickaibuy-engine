export const JOB_NAMES = {
  TREND_EXPAND: "trend:expand",
} as const;

export type JobName = typeof JOB_NAMES[keyof typeof JOB_NAMES];
