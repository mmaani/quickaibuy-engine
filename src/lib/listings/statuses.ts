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

export const LISTING_PUBLISH_ENTRY_STATUS = LISTING_STATUSES.READY_TO_PUBLISH;
export const LISTING_LIVE_SUCCESS_STATUS = LISTING_STATUSES.ACTIVE;

export const LISTING_MONITOR_STATUSES = [
  LISTING_STATUSES.READY_TO_PUBLISH,
  LISTING_STATUSES.PUBLISH_IN_PROGRESS,
  LISTING_STATUSES.ACTIVE,
  LISTING_STATUSES.PUBLISH_FAILED,
  LISTING_STATUSES.PAUSED,
] as const;

export const LISTING_ACTIVE_PATH_STATUSES = [
  LISTING_STATUSES.READY_TO_PUBLISH,
  LISTING_STATUSES.PUBLISH_IN_PROGRESS,
  LISTING_STATUSES.ACTIVE,
] as const;

const LISTING_STATUS_SET = new Set<string>(Object.values(LISTING_STATUSES));

export function isListingStatus(value: string): value is ListingStatus {
  return LISTING_STATUS_SET.has(value);
}

export function isPublishEntryListingStatus(value: string): value is typeof LISTING_PUBLISH_ENTRY_STATUS {
  return value === LISTING_PUBLISH_ENTRY_STATUS;
}

export function isLiveSuccessListingStatus(value: string): value is typeof LISTING_LIVE_SUCCESS_STATUS {
  return value === LISTING_LIVE_SUCCESS_STATUS;
}

export function isPausedListingStatus(value: string): value is typeof LISTING_STATUSES.PAUSED {
  return value === LISTING_STATUSES.PAUSED;
}

export function isListingMonitorStatus(value: string): value is (typeof LISTING_MONITOR_STATUSES)[number] {
  return (LISTING_MONITOR_STATUSES as readonly string[]).includes(value);
}

const LISTING_STATUS_TRANSITIONS: Readonly<Record<ListingStatus, readonly ListingStatus[]>> = {
  PREVIEW: [LISTING_STATUSES.READY_TO_PUBLISH, LISTING_STATUSES.PAUSED],
  READY_TO_PUBLISH: [LISTING_STATUSES.PUBLISH_IN_PROGRESS, LISTING_STATUSES.PAUSED],
  PUBLISH_IN_PROGRESS: [LISTING_STATUSES.ACTIVE, LISTING_STATUSES.PUBLISH_FAILED, LISTING_STATUSES.PAUSED],
  ACTIVE: [LISTING_STATUSES.PAUSED, LISTING_STATUSES.ENDED],
  PUBLISH_FAILED: [LISTING_STATUSES.READY_TO_PUBLISH, LISTING_STATUSES.PAUSED],
  PAUSED: [LISTING_STATUSES.PREVIEW, LISTING_STATUSES.ENDED],
  ENDED: [],
};

export function getAllowedNextListingStatuses(current: ListingStatus): readonly ListingStatus[] {
  return LISTING_STATUS_TRANSITIONS[current] ?? [];
}

export function canTransitionListingStatus(current: ListingStatus, next: ListingStatus): boolean {
  if (current === next) return true;
  return getAllowedNextListingStatuses(current).includes(next);
}
