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

export const LISTING_PREVIEW_STATUS = LISTING_STATUSES.PREVIEW;
export const LISTING_PUBLISH_ENTRY_STATUS = LISTING_STATUSES.READY_TO_PUBLISH;
export const LISTING_PUBLISH_IN_PROGRESS_STATUS = LISTING_STATUSES.PUBLISH_IN_PROGRESS;
export const LISTING_LIVE_SUCCESS_STATUS = LISTING_STATUSES.ACTIVE;
export const LISTING_PUBLISH_FAILED_STATUS = LISTING_STATUSES.PUBLISH_FAILED;
export const LISTING_PAUSED_STATUS = LISTING_STATUSES.PAUSED;
export const LISTING_ENDED_STATUS = LISTING_STATUSES.ENDED;
export const LISTING_INVENTORY_RISK_SCAN_ENTRY_STATUS = LISTING_STATUSES.ACTIVE;

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

export const LISTING_DUPLICATE_BLOCKING_STATUSES = [
  LISTING_STATUSES.PREVIEW,
  ...LISTING_ACTIVE_PATH_STATUSES,
] as const;

const LISTING_STATUS_SET = new Set<string>(Object.values(LISTING_STATUSES));
const LISTING_MONITOR_STATUS_SET = new Set<string>(LISTING_MONITOR_STATUSES);
const LISTING_ACTIVE_PATH_STATUS_SET = new Set<string>(LISTING_ACTIVE_PATH_STATUSES);
const LISTING_DUPLICATE_BLOCKING_STATUS_SET = new Set<string>(LISTING_DUPLICATE_BLOCKING_STATUSES);

export function isListingStatus(value: string): value is ListingStatus {
  return LISTING_STATUS_SET.has(value);
}

export function isPreviewListingStatus(value: string): value is typeof LISTING_PREVIEW_STATUS {
  return value === LISTING_PREVIEW_STATUS;
}

export function isPublishEntryListingStatus(value: string): value is typeof LISTING_PUBLISH_ENTRY_STATUS {
  return value === LISTING_PUBLISH_ENTRY_STATUS;
}

export function isPublishInProgressListingStatus(
  value: string
): value is typeof LISTING_PUBLISH_IN_PROGRESS_STATUS {
  return value === LISTING_PUBLISH_IN_PROGRESS_STATUS;
}

export function isLiveSuccessListingStatus(value: string): value is typeof LISTING_LIVE_SUCCESS_STATUS {
  return value === LISTING_LIVE_SUCCESS_STATUS;
}

export function isPublishFailedListingStatus(
  value: string
): value is typeof LISTING_PUBLISH_FAILED_STATUS {
  return value === LISTING_PUBLISH_FAILED_STATUS;
}

export function isPausedListingStatus(value: string): value is typeof LISTING_STATUSES.PAUSED {
  return value === LISTING_PAUSED_STATUS;
}

export function isEndedListingStatus(value: string): value is typeof LISTING_ENDED_STATUS {
  return value === LISTING_ENDED_STATUS;
}

export function isInventoryRiskScanEntryListingStatus(
  value: string
): value is typeof LISTING_INVENTORY_RISK_SCAN_ENTRY_STATUS {
  return value === LISTING_INVENTORY_RISK_SCAN_ENTRY_STATUS;
}

export function isListingMonitorStatus(value: string): value is (typeof LISTING_MONITOR_STATUSES)[number] {
  return LISTING_MONITOR_STATUS_SET.has(value);
}

export function isActivePathListingStatus(value: string): value is (typeof LISTING_ACTIVE_PATH_STATUSES)[number] {
  return LISTING_ACTIVE_PATH_STATUS_SET.has(value);
}

export function isDuplicateBlockingListingStatus(
  value: string
): value is (typeof LISTING_DUPLICATE_BLOCKING_STATUSES)[number] {
  return LISTING_DUPLICATE_BLOCKING_STATUS_SET.has(value);
}

export function canResumePausedListingStatus(value: string): boolean {
  return isPausedListingStatus(value);
}

export function canPromotePreviewListingStatus(value: string): boolean {
  return isPreviewListingStatus(value);
}

export function canEnterPublishPathFromListingStatus(value: string): boolean {
  return isPublishEntryListingStatus(value);
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
