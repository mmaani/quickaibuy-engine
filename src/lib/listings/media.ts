import { getMediaStorageMode } from "@/lib/media/storage";
import type {
  ListingPreviewInput,
  ListingPreviewMedia,
  ListingPreviewMediaHostingMode,
  ListingPreviewMediaImage,
  ListingPreviewMediaImageKind,
  ListingPreviewMediaVideo,
} from "./types";

export const EBAY_MAX_IMAGES = 24;

type MediaCandidate = {
  url: string;
  normalizedUrl: string;
  fingerprint: string;
  source: "supplier" | "marketplace";
  kind: ListingPreviewMediaImageKind;
  reasons: string[];
  score: number;
  index: number;
  hostingMode: ListingPreviewMediaHostingMode;
};

type VideoCandidate = {
  url: string;
  format: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
};

const IMAGE_KEY_HINTS = ["image", "img", "photo", "picture", "gallery", "album", "main"];
const VIDEO_KEY_HINTS = ["video", "mp4", "mov", "webm", "media"];

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeMediaUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripUrlNoise(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function buildFingerprint(url: string): string {
  const stable = stripUrlNoise(url).toLowerCase();
  const parsed = new URL(stable);
  const baseName = parsed.pathname.split("/").pop() ?? parsed.pathname;
  return `${parsed.hostname}|${baseName
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]?(?:\d{2,4}x\d{2,4}|copy|small|large|zoom|thumb|thumbnail|main|hero|detail)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, "")
    .slice(0, 80)}`;
}

function inferHostingMode(url: string): ListingPreviewMediaHostingMode {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const siteHost = stringOrNull(process.env.WEBSITE_URL)
      ? new URL(process.env.WEBSITE_URL as string).hostname.toLowerCase()
      : null;

    if (host.endsWith("ebayimg.com")) return "eps";
    if (siteHost && host === siteHost) return "self_hosted";
  } catch {
    return "external";
  }

  return "external";
}

function looksBrokenUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (/(placeholder|default-image|no-image|image-not-found|missing-image)/.test(lower)) return true;
  if (/[?&](?:error|broken)=/.test(lower)) return true;
  return false;
}

function looksTooSmall(url: string): boolean {
  const match = url.match(/(?:^|[_x=/-])(\d{1,4})[xX](\d{1,4})(?:$|[_.?&/-])/);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  return width < 200 || height < 200;
}

function looksWatermarkHeavy(url: string): boolean {
  return /(watermark|logo-overlay|logoover|sticker|banner|promo|qr[-_]?code)/i.test(url);
}

function classifyImageKind(url: string, index: number): { kind: ListingPreviewMediaImageKind; score: number; reasons: string[] } {
  const lower = url.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  let kind: ListingPreviewMediaImageKind = "other";

  if (/(hero|main|primary|front|white|plain|product)/.test(lower) || index === 0) {
    kind = "hero";
    score += 300;
    reasons.push("hero-priority");
  }

  if (/(side|back|top|bottom|angle|detail|closeup|zoom)/.test(lower)) {
    kind = kind === "hero" ? "hero" : "angle";
    score += 220;
    reasons.push("clean-angle");
  }

  if (/(lifestyle|scene|usage|room|outdoor|indoor|model|wearing|in-use|kitchen|desk|hand)/.test(lower)) {
    kind = "lifestyle";
    score += 120;
    reasons.push("lifestyle");
  }

  if (/(detail|closeup|zoom)/.test(lower) && kind === "other") {
    kind = "detail";
    score += 160;
    reasons.push("detail");
  }

  if (/(infographic|size-chart|chart|dimensions|spec|instructions|manual|package)/.test(lower)) {
    if (kind === "other") kind = "detail";
    score -= 30;
    reasons.push("supporting-detail");
  }

  if (/(collage|thumbnail|thumb|icon|logo|swatch|variant|sku)/.test(lower)) {
    score -= 180;
    reasons.push("low-value");
  }

  score -= index;

  return { kind, score, reasons };
}

function pushImageCandidate(
  out: MediaCandidate[],
  rawUrl: string,
  source: "supplier" | "marketplace",
  index: number
): void {
  const normalizedUrl = normalizeMediaUrl(rawUrl);
  if (!normalizedUrl) return;
  if (looksBrokenUrl(normalizedUrl) || looksTooSmall(normalizedUrl) || looksWatermarkHeavy(normalizedUrl)) return;

  const classification = classifyImageKind(normalizedUrl, index);
  out.push({
    url: normalizedUrl,
    normalizedUrl: stripUrlNoise(normalizedUrl),
    fingerprint: buildFingerprint(normalizedUrl),
    source,
    kind: classification.kind,
    reasons: classification.reasons,
    score: classification.score,
    index,
    hostingMode: inferHostingMode(normalizedUrl),
  });
}

function looksLikeImageKey(key: string): boolean {
  const lower = key.toLowerCase();
  return IMAGE_KEY_HINTS.some((hint) => lower.includes(hint));
}

function looksLikeVideoKey(key: string): boolean {
  const lower = key.toLowerCase();
  return VIDEO_KEY_HINTS.some((hint) => lower.includes(hint));
}

function isImageUrl(url: string, hintKey?: string): boolean {
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif|avif)(?:[?#].*)?$/i.test(lower)) return true;
  if (hintKey && looksLikeImageKey(hintKey)) return true;
  return /(image|img|photo|gallery)/i.test(lower);
}

function isVideoUrl(url: string, hintKey?: string): boolean {
  const lower = url.toLowerCase();
  if (/\.(mp4|mov|webm|m4v)(?:[?#].*)?$/i.test(lower)) return true;
  if (hintKey && looksLikeVideoKey(hintKey)) return true;
  return /video/i.test(lower);
}

function walkForMedia(
  value: unknown,
  state: {
    imageUrls: Array<{ url: string; source: "supplier" | "marketplace"; index: number }>;
    videos: VideoCandidate[];
    seenObjects: Set<unknown>;
    nextIndex: number;
  },
  source: "supplier" | "marketplace",
  hintKey?: string
): void {
  if (value == null) return;
  if (typeof value === "string") {
    const normalized = normalizeMediaUrl(value);
    if (!normalized) return;

    if (isImageUrl(normalized, hintKey)) {
      state.imageUrls.push({ url: normalized, source, index: state.nextIndex++ });
      return;
    }

    if (isVideoUrl(normalized, hintKey)) {
      state.videos.push({
        url: normalized,
        format: normalized.match(/\.([a-z0-9]{3,4})(?:[?#].*)?$/i)?.[1]?.toLowerCase() ?? null,
        durationSeconds: null,
        sizeBytes: null,
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      walkForMedia(entry, state, source, hintKey);
    }
    return;
  }

  const obj = objectOrNull(value);
  if (!obj || state.seenObjects.has(obj)) return;
  state.seenObjects.add(obj);

  const directUrl =
    stringOrNull(obj.url) ??
    stringOrNull(obj.imageUrl) ??
    stringOrNull(obj.image_url) ??
    stringOrNull(obj.videoUrl) ??
    stringOrNull(obj.video_url) ??
    stringOrNull(obj.src);

  if (directUrl) {
    const format =
      stringOrNull(obj.format) ??
      stringOrNull(obj.mimeType) ??
      stringOrNull(obj.mime_type) ??
      directUrl.match(/\.([a-z0-9]{3,4})(?:[?#].*)?$/i)?.[1]?.toLowerCase() ??
      null;
    const durationSeconds =
      numberOrNull(obj.durationSeconds) ??
      numberOrNull(obj.duration_seconds) ??
      numberOrNull(obj.duration);
    const sizeBytes = numberOrNull(obj.sizeBytes) ?? numberOrNull(obj.size_bytes) ?? numberOrNull(obj.fileSize);

    if (isVideoUrl(directUrl, hintKey)) {
      const normalized = normalizeMediaUrl(directUrl);
      if (normalized) {
        state.videos.push({
          url: normalized,
          format: format ? format.toLowerCase() : null,
          durationSeconds,
          sizeBytes,
        });
      }
    } else if (isImageUrl(directUrl, hintKey)) {
      const normalized = normalizeMediaUrl(directUrl);
      if (normalized) {
        state.imageUrls.push({ url: normalized, source, index: state.nextIndex++ });
      }
    }
  }

  for (const [key, nested] of Object.entries(obj)) {
    walkForMedia(nested, state, source, key);
  }
}

function dedupeAndRankImages(candidates: MediaCandidate[]): {
  selected: ListingPreviewMediaImage[];
  selectedUrls: string[];
  mixedImageHostingModesDropped: boolean;
  imageHostingMode: ListingPreviewMediaHostingMode | null;
} {
  const exactSeen = new Set<string>();
  const fingerprintSeen = new Set<string>();
  const deduped: MediaCandidate[] = [];

  for (const candidate of candidates) {
    if (exactSeen.has(candidate.normalizedUrl) || fingerprintSeen.has(candidate.fingerprint)) continue;
    exactSeen.add(candidate.normalizedUrl);
    fingerprintSeen.add(candidate.fingerprint);
    deduped.push(candidate);
  }

  deduped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  const modeCounts = new Map<ListingPreviewMediaHostingMode, number>();
  for (const candidate of deduped) {
    modeCounts.set(candidate.hostingMode, (modeCounts.get(candidate.hostingMode) ?? 0) + 1);
  }

  const imageHostingMode =
    Array.from(modeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mixedImageHostingModesDropped = modeCounts.size > 1;
  const normalized = deduped
    .filter((candidate) => (imageHostingMode ? candidate.hostingMode === imageHostingMode : true))
    .slice(0, EBAY_MAX_IMAGES)
    .map<ListingPreviewMediaImage>((candidate, index) => ({
      url: candidate.url,
      kind: candidate.kind,
      rank: index + 1,
      source: candidate.source,
      fingerprint: candidate.fingerprint,
      hostingMode: candidate.hostingMode,
      reasons: candidate.reasons,
    }));

  return {
    selected: normalized,
    selectedUrls: normalized.map((entry) => entry.url),
    mixedImageHostingModesDropped,
    imageHostingMode,
  };
}

function validateVideo(candidate: VideoCandidate | null): ListingPreviewMediaVideo | null {
  if (!candidate) return null;

  const allowedFormats = new Set(["mp4", "mov", "webm", "m4v"]);
  const format = candidate.format?.toLowerCase() ?? null;
  let validationOk = true;
  let validationReason: string | null = null;

  if (format && !allowedFormats.has(format)) {
    validationOk = false;
    validationReason = `unsupported video format: ${format}`;
  } else if (candidate.sizeBytes != null && candidate.sizeBytes > 500 * 1024 * 1024) {
    validationOk = false;
    validationReason = "video file too large";
  } else if (candidate.durationSeconds != null && candidate.durationSeconds > 120) {
    validationOk = false;
    validationReason = "video too long";
  }

  const publishSupported = false;
  const attachOnPublish = publishSupported && validationOk;
  const operatorNote = !attachOnPublish && validationOk ? "video available; manual add recommended" : null;

  return {
    url: candidate.url,
    format,
    durationSeconds: candidate.durationSeconds,
    sizeBytes: candidate.sizeBytes,
    validationOk,
    validationReason,
    attachOnPublish,
    publishSupported,
    operatorNote,
  };
}

export function buildListingPreviewMedia(input: ListingPreviewInput): ListingPreviewMedia {
  const storageMode = getMediaStorageMode();
  if (storageMode !== "reference_only") {
    throw new Error(`Unsupported MEDIA_STORAGE_MODE for listing preview media: ${storageMode}`);
  }

  const candidates: MediaCandidate[] = [];

  const state = {
    imageUrls: [] as Array<{ url: string; source: "supplier" | "marketplace"; index: number }>,
    videos: [] as VideoCandidate[],
    seenObjects: new Set<unknown>(),
    nextIndex: 0,
  };

  for (const url of input.supplierImages ?? []) {
    if (typeof url === "string") {
      state.imageUrls.push({ url, source: "supplier", index: state.nextIndex++ });
    }
  }

  if (input.supplierImageUrl) {
    state.imageUrls.push({ url: input.supplierImageUrl, source: "supplier", index: state.nextIndex++ });
  }

  if (input.marketplaceImageUrl) {
    state.imageUrls.push({ url: input.marketplaceImageUrl, source: "marketplace", index: state.nextIndex++ });
  }

  walkForMedia(input.supplierRawPayload, state, "supplier");

  for (const entry of state.imageUrls) {
    pushImageCandidate(candidates, entry.url, entry.source, entry.index);
  }

  const ranked = dedupeAndRankImages(candidates);
  const video = validateVideo(state.videos[0] ?? null);
  const videoSkippedReason =
    !video
      ? "no supplier video detected"
      : !video.validationOk
        ? video.validationReason
        : video.attachOnPublish
          ? null
          : "publish path not verified safe for video";

  return {
    images: ranked.selected,
    video,
    audit: {
      imageCandidateCount: candidates.length,
      imageSelectedCount: ranked.selected.length,
      imageSkippedCount: Math.max(0, candidates.length - ranked.selected.length),
      imageHostingMode: ranked.imageHostingMode,
      mixedImageHostingModesDropped: ranked.mixedImageHostingModesDropped,
      selectedImageUrls: ranked.selectedUrls,
      videoDetected: Boolean(video),
      videoAttached: Boolean(video?.attachOnPublish),
      videoSkipped: !video?.attachOnPublish,
      videoSkipReason: videoSkippedReason,
      operatorNote: video?.operatorNote ?? null,
    },
  };
}
