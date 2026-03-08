export const LISTING_STATUSES = {
  PREVIEW: "PREVIEW",
  READY_TO_PUBLISH: "READY_TO_PUBLISH",
  PUBLISH_IN_PROGRESS: "PUBLISH_IN_PROGRESS",
  ACTIVE: "ACTIVE",
  PUBLISH_FAILED: "PUBLISH_FAILED",
  PAUSED: "PAUSED",
  ENDED: "ENDED",
} as const;

export type ListingStatus = (typeof LISTING_STATUSES)[keyof typeof LISTING_STATUSES];

export const EXECUTABLE_LISTING_MARKETPLACES = ["ebay"] as const;
export type ExecutableListingMarketplace = (typeof EXECUTABLE_LISTING_MARKETPLACES)[number];
