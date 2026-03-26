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
const EBAY_TARGET_IMAGE_COUNT = 10;
const EBAY_MIN_LONGEST_SIDE_PX = 500;

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
  longestSide: number | null;
  aspectRatio: number | null;
  isLifestyle: boolean;
  isScale: boolean;
  isPackaging: boolean;
  isTextHeavy: boolean;
  isCollage: boolean;
  isDark: boolean;
  isGlow: boolean;
  isDetail: boolean;
  isAngle: boolean;
  hasCleanBackground: boolean;
  hasCenteredSubject: boolean;
  hasStrongProductFill: boolean;
  qualityFloor: number;
};

type VideoCandidate = {
  url: string;
  format: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
};

type ProductMediaContext = {
  lightingDecor: boolean;
  gadgetTool: boolean;
  wearableAccessory: boolean;
  multiPart: boolean;
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
    if (parsed.hostname.toLowerCase().endsWith("ebayimg.com")) {
      // Browse payloads often ship thumbnail EPS variants like s-l225; prefer the larger source asset.
      parsed.pathname = parsed.pathname.replace(/\/s-l\d{2,4}(\.[a-z0-9]+)$/i, "/s-l1600$1");
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
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
  const ebayGalleryToken = parsed.pathname.match(/\/images\/g\/([^/]+)\//i)?.[1] ?? null;
  const baseName = parsed.pathname.split("/").pop() ?? parsed.pathname;
  const fingerprintBase =
    parsed.hostname.endsWith("ebayimg.com") && ebayGalleryToken
      ? ebayGalleryToken
      : baseName;
  return `${parsed.hostname}|${baseName
    .replace(/^s-l\d{2,4}$/i, fingerprintBase)
    .replace(/^s-l\d{2,4}\.[a-z0-9]+$/i, fingerprintBase)
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
  const dimensions = parseImageDimensions(url);
  if (!dimensions?.longestSide) return false;
  return dimensions.longestSide < EBAY_MIN_LONGEST_SIDE_PX;
}

function looksWatermarkHeavy(url: string): boolean {
  return /(watermark|logo-overlay|logoover|sticker|banner|promo|qr[-_]?code)/i.test(url);
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function parseImageDimensions(url: string): { width: number; height: number; longestSide: number; aspectRatio: number } | null {
  const ebaySize = url.match(/\/s-l(\d{2,4})(?:\.[a-z0-9]+)(?:$|[?#])/i);
  if (ebaySize) {
    const side = Number(ebaySize[1]);
    if (Number.isFinite(side) && side > 0) {
      return {
        width: side,
        height: side,
        longestSide: side,
        aspectRatio: 1,
      };
    }
  }

  const matches = Array.from(
    url.matchAll(/(?:^|[_=/-])(\d{2,4})[xX](\d{2,4})(?:q\d+)?(?:$|[_.?&/-])/g)
  );
  const last = matches[matches.length - 1];
  if (!last) return null;

  const width = Number(last[1]);
  const height = Number(last[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return {
    width,
    height,
    longestSide: Math.max(width, height),
    aspectRatio: width / height,
  };
}

function inferProductMediaContext(input: ListingPreviewInput): ProductMediaContext {
  const text = normalizeText(input.supplierTitle, input.marketplaceTitle);

  return {
    lightingDecor: /(lamp|light|lighting|ambient|night light|crystal|acrylic|decor)/.test(text),
    gadgetTool: /(gadget|tool|charger|mount|holder|speaker|fan)/.test(text),
    wearableAccessory: /(watch|bracelet|necklace|ring|wallet|bag|case)/.test(text),
    multiPart: /(kit|set|bundle|pack|parts|components|accessories)/.test(text),
  };
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

function buildQualitySignals(url: string, index: number): {
  longestSide: number | null;
  aspectRatio: number | null;
  isLifestyle: boolean;
  isScale: boolean;
  isPackaging: boolean;
  isTextHeavy: boolean;
  isCollage: boolean;
  isDark: boolean;
  isGlow: boolean;
  isDetail: boolean;
  isAngle: boolean;
  hasCleanBackground: boolean;
  hasCenteredSubject: boolean;
  hasStrongProductFill: boolean;
  qualityFloor: number;
  reasons: string[];
} {
  const lower = url.toLowerCase();
  const dimensions = parseImageDimensions(url);
  const reasons: string[] = [];
  let qualityFloor = 0;

  const isLifestyle = containsAny(lower, [/(lifestyle|scene|room|desk|bedside|in[-_]?use|setup|usage|hand)/]);
  const isScale = containsAny(lower, [/(size|dimension|measure|comparison|scale|hand|palm|cm|inch)/]);
  const isPackaging = containsAny(lower, [/(package|packaging|box|manual|accessories|adapter|cable|components)/]);
  const isTextHeavy = containsAny(lower, [/(text|promo|sale|offer|spec|feature|benefit|infographic|chart|caption)/]);
  const isCollage = containsAny(lower, [/(collage|grid|sheet|multi|combo|sprite)/]);
  const isDark = containsAny(lower, [/(dark|night|blackbg|black-background|shadow)/]);
  const isGlow = containsAny(lower, [/(glow|lit|lighton|ambient|night-light|illumination)/]);
  const isDetail = containsAny(lower, [/(detail|close|zoom|macro|texture|material)/]);
  const isAngle = containsAny(lower, [/(side|back|top|bottom|angle|perspective)/]);
  const hasCleanBackground = containsAny(lower, [/(white|plain|clean|studio|isolated|cutout)/]);
  const hasCenteredSubject = containsAny(lower, [/(front|center|centered|hero|main|primary)/]) || index === 0;
  const hasStrongProductFill = containsAny(lower, [/(close|front|hero|main|primary|macro|detail)/]);

  if (dimensions) {
    if (dimensions.longestSide >= 1600) {
      qualityFloor += 80;
      reasons.push("resolution-1600-plus");
    } else if (dimensions.longestSide >= 1200) {
      qualityFloor += 55;
      reasons.push("resolution-1200-plus");
    } else if (dimensions.longestSide >= 1000) {
      qualityFloor += 35;
      reasons.push("resolution-1000-plus");
    } else if (dimensions.longestSide >= EBAY_MIN_LONGEST_SIDE_PX) {
      qualityFloor += 10;
      reasons.push("resolution-meets-ebay-min");
    }

    if (dimensions.aspectRatio >= 0.8 && dimensions.aspectRatio <= 1.4) {
      qualityFloor += 18;
      reasons.push("mobile-friendly-aspect");
    } else if (dimensions.aspectRatio >= 0.65 && dimensions.aspectRatio <= 1.8) {
      qualityFloor += 6;
      reasons.push("acceptable-aspect");
    } else {
      qualityFloor -= 18;
      reasons.push("awkward-aspect");
    }
  }

  if (hasCleanBackground) {
    qualityFloor += 25;
    reasons.push("clean-background");
  }
  if (hasCenteredSubject) {
    qualityFloor += 18;
    reasons.push("subject-centered");
  }
  if (hasStrongProductFill) {
    qualityFloor += 16;
    reasons.push("strong-product-fill");
  }
  if (isTextHeavy) {
    qualityFloor -= 60;
    reasons.push("text-heavy");
  }
  if (isCollage) {
    qualityFloor -= 70;
    reasons.push("collage");
  }
  if (isPackaging) {
    qualityFloor -= 35;
    reasons.push("packaging-secondary");
  }
  if (containsAny(lower, [/(blur|blurry|compressed|lowres|low-res|pixel)/])) {
    qualityFloor -= 45;
    reasons.push("blur-compression-risk");
  }
  if (containsAny(lower, [/(screenshot|screen-shot|screen_shot)/])) {
    qualityFloor -= 90;
    reasons.push("screenshot");
  }

  return {
    longestSide: dimensions?.longestSide ?? null,
    aspectRatio: dimensions?.aspectRatio ?? null,
    isLifestyle,
    isScale,
    isPackaging,
    isTextHeavy,
    isCollage,
    isDark,
    isGlow,
    isDetail,
    isAngle,
    hasCleanBackground,
    hasCenteredSubject,
    hasStrongProductFill,
    qualityFloor,
    reasons,
  };
}

function scoreHeroCandidate(candidate: MediaCandidate, context: ProductMediaContext): number {
  let score = candidate.score + candidate.qualityFloor;
  if (candidate.isLifestyle) score -= 30;
  if (candidate.isScale) score -= 25;
  if (candidate.isPackaging) score -= 40;
  if (candidate.isTextHeavy || candidate.isCollage) score -= 80;
  if (context.lightingDecor && candidate.isGlow) score += 20;
  if (candidate.isDark && !(context.lightingDecor && candidate.isGlow)) score -= 22;
  if (candidate.hasCleanBackground) score += 24;
  if (candidate.hasCenteredSubject) score += 18;
  if (candidate.hasStrongProductFill) score += 20;
  return score;
}

function scoreCoreSupportingCandidate(candidate: MediaCandidate, context: ProductMediaContext): number {
  let score = candidate.score + candidate.qualityFloor;
  if (candidate.isPackaging) score -= 30;
  if (candidate.isTextHeavy || candidate.isCollage) score -= 60;
  if (candidate.isAngle) score += 20;
  if (candidate.isDetail) score += 18;
  if (context.lightingDecor && candidate.isGlow) score += 16;
  if (context.wearableAccessory && candidate.isDetail) score += 20;
  if (context.gadgetTool && candidate.isScale) score += 14;
  return score;
}

function scoreContextCandidate(candidate: MediaCandidate, context: ProductMediaContext): number {
  let score = candidate.score + candidate.qualityFloor;
  if (candidate.isPackaging) score -= 18;
  if (candidate.isTextHeavy || candidate.isCollage) score -= 50;
  if (candidate.isLifestyle) score += 24;
  if (candidate.isScale) score += 22;
  if (context.gadgetTool && candidate.isLifestyle) score += 10;
  if (context.multiPart && candidate.isPackaging) score += 8;
  return score;
}

function scoreOptionalSupportCandidate(candidate: MediaCandidate, context: ProductMediaContext): number {
  let score = candidate.score + candidate.qualityFloor;
  if (candidate.isPackaging) score -= context.multiPart ? 6 : 20;
  if (candidate.isTextHeavy || candidate.isCollage) score -= 45;
  if (candidate.isLifestyle) score += 10;
  if (candidate.isDetail) score += 12;
  if (candidate.isScale) score += 10;
  return score;
}

function selectTopCandidates(
  candidates: MediaCandidate[],
  maxCount: number,
  scorer: (candidate: MediaCandidate) => number,
  extraReason: string
): MediaCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, slotScore: scorer(candidate) }))
    .sort((a, b) => {
      if (b.slotScore !== a.slotScore) return b.slotScore - a.slotScore;
      if (b.candidate.qualityFloor !== a.candidate.qualityFloor) {
        return b.candidate.qualityFloor - a.candidate.qualityFloor;
      }
      return a.candidate.index - b.candidate.index;
    })
    .slice(0, maxCount)
    .map(({ candidate }) => ({
      ...candidate,
      reasons: [...candidate.reasons, extraReason],
    }));
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
  const signals = buildQualitySignals(normalizedUrl, index);
  out.push({
    url: normalizedUrl,
    normalizedUrl: stripUrlNoise(normalizedUrl),
    fingerprint: buildFingerprint(normalizedUrl),
    source,
    kind: classification.kind,
    reasons: [...classification.reasons, ...signals.reasons],
    score: classification.score,
    index,
    hostingMode: inferHostingMode(normalizedUrl),
    longestSide: signals.longestSide,
    aspectRatio: signals.aspectRatio,
    isLifestyle: signals.isLifestyle,
    isScale: signals.isScale,
    isPackaging: signals.isPackaging,
    isTextHeavy: signals.isTextHeavy,
    isCollage: signals.isCollage,
    isDark: signals.isDark,
    isGlow: signals.isGlow,
    isDetail: signals.isDetail,
    isAngle: signals.isAngle,
    hasCleanBackground: signals.hasCleanBackground,
    hasCenteredSubject: signals.hasCenteredSubject,
    hasStrongProductFill: signals.hasStrongProductFill,
    qualityFloor: signals.qualityFloor,
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

function dedupeAndRankImages(candidates: MediaCandidate[], context: ProductMediaContext): {
  selected: ListingPreviewMediaImage[];
  selectedUrls: string[];
  mixedImageHostingModesDropped: boolean;
  imageHostingMode: ListingPreviewMediaHostingMode | null;
  selectedKinds: string[];
  selectedSlots: string[];
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

  const modeCounts = new Map<ListingPreviewMediaHostingMode, number>();
  for (const candidate of deduped) {
    modeCounts.set(candidate.hostingMode, (modeCounts.get(candidate.hostingMode) ?? 0) + 1);
  }

  const imageHostingMode =
    Array.from(modeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mixedImageHostingModesDropped = modeCounts.size > 1;
  const sameMode = deduped.filter((candidate) => (imageHostingMode ? candidate.hostingMode === imageHostingMode : true));

  const hero = selectTopCandidates(
    sameMode.filter((candidate) => !candidate.isPackaging && !candidate.isTextHeavy && !candidate.isCollage),
    1,
    (candidate) => scoreHeroCandidate(candidate, context),
    "slot-1-hero"
  );
  if (hero.length === 0 && sameMode.length > 0) {
    hero.push(
      ...selectTopCandidates(sameMode, 1, (candidate) => scoreHeroCandidate(candidate, context), "slot-1-hero")
    );
  }
  const used = new Set(hero.map((candidate) => candidate.normalizedUrl));
  const remaining = sameMode.filter((candidate) => !used.has(candidate.normalizedUrl));

  const core = selectTopCandidates(
    remaining.filter((candidate) => !candidate.isPackaging),
    3,
    (candidate) => scoreCoreSupportingCandidate(candidate, context),
    "slot-2-4-core"
  );
  for (const candidate of core) used.add(candidate.normalizedUrl);

  const contextImages = selectTopCandidates(
    remaining.filter((candidate) => !used.has(candidate.normalizedUrl)),
    2,
    (candidate) => scoreContextCandidate(candidate, context),
    "slot-5-6-context"
  );
  for (const candidate of contextImages) used.add(candidate.normalizedUrl);

  const support = selectTopCandidates(
    remaining.filter((candidate) => !used.has(candidate.normalizedUrl)),
    Math.max(0, EBAY_TARGET_IMAGE_COUNT - hero.length - core.length - contextImages.length),
    (candidate) => scoreOptionalSupportCandidate(candidate, context),
    "slot-7-plus-support"
  ).filter((candidate) => scoreOptionalSupportCandidate(candidate, context) >= 40);

  const orderedCandidates = [...hero, ...core, ...contextImages, ...support].slice(0, Math.min(EBAY_TARGET_IMAGE_COUNT, EBAY_MAX_IMAGES));

  const normalized = orderedCandidates.map<ListingPreviewMediaImage>((candidate, index) => ({
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
    selectedKinds: normalized.map((entry) => entry.kind),
    selectedSlots: normalized.map((entry) => {
      if (entry.rank === 1) return "slot-1-hero";
      if (entry.rank <= 4) return "slot-2-4-core";
      if (entry.rank <= 6) return "slot-5-6-context";
      return "slot-7-plus-support";
    }),
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
  walkForMedia(input.marketplaceRawPayload, state, "marketplace");

  for (const entry of state.imageUrls) {
    pushImageCandidate(candidates, entry.url, entry.source, entry.index);
  }

  const ranked = dedupeAndRankImages(candidates, inferProductMediaContext(input));
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
      selectedImageKinds: ranked.selectedKinds,
      selectedImageSlots: ranked.selectedSlots,
      videoDetected: Boolean(video),
      videoAttached: Boolean(video?.attachOnPublish),
      videoSkipped: !video?.attachOnPublish,
      videoSkipReason: videoSkippedReason,
      operatorNote: video?.operatorNote ?? null,
    },
  };
}
