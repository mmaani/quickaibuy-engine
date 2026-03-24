import {
  classifyHostedImage,
  createMockEbayImageHostingProvider,
  normalizeImageFromUrl,
  type EbayHostedImageMode,
  type EbayImageHostingProvider,
  type EbayImageNormalizationCode,
} from "@/lib/marketplaces/ebayImageHosting";

export type EbayImageNormalizationStatus = {
  code: EbayImageNormalizationCode;
  ok: boolean;
  selectedSourceCount: number;
  normalizedEpsCount: number;
  cacheHits: number;
  freshUploads: number;
  failedSourceUrls: string[];
  finalSlotOrder: string[];
  provider: string | null;
  providerAttempted: string | null;
  providerUsed: string | null;
  mediaApiAttempted: boolean;
  mediaApiResultCode: EbayImageNormalizationCode | null;
  tradingFallbackAttempted: boolean;
  tradingFallbackResultCode: EbayImageNormalizationCode | null;
  blockingReason: string | null;
};

export type NormalizeEbayListingImagesResult = {
  ok: boolean;
  payload: Record<string, unknown>;
  response: Record<string, unknown> | null;
  diagnostics: EbayImageNormalizationStatus;
};

type NormalizableImage = {
  url: string;
  source: string | null;
  kind: string | null;
  rank: number;
  fingerprint: string | null;
  reasons: string[];
};

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => stringOrNull(entry)).filter((entry): entry is string => Boolean(entry));
}

function readSelectedImages(payload: Record<string, unknown>): NormalizableImage[] {
  const media = objectOrNull(payload.media);
  const mediaImages = Array.isArray(media?.images) ? media.images : [];
  if (mediaImages.length > 0) {
    const mapped = mediaImages.map((entry, index) => {
        const image = objectOrNull(entry);
        const url = stringOrNull(image?.url);
        if (!url) return null;
        return {
          url,
          source: stringOrNull(image?.source),
          kind: stringOrNull(image?.kind),
          rank: typeof image?.rank === "number" ? image.rank : index + 1,
          fingerprint: stringOrNull(image?.fingerprint),
          reasons: Array.isArray(image?.reasons)
            ? (image?.reasons as unknown[]).map((reason) => stringOrNull(reason)).filter(Boolean) as string[]
            : [],
        };
      });
    return mapped.filter((image): image is NormalizableImage => image !== null);
  }

  return stringArray(payload.images).map((url, index) => ({
    url,
    source: null,
    kind: null,
    rank: index + 1,
    fingerprint: null,
    reasons: [],
  }));
}

function buildDiagnostics(
  code: EbayImageNormalizationCode,
  ok: boolean,
  input: Partial<EbayImageNormalizationStatus>
): EbayImageNormalizationStatus {
  return {
    code,
    ok,
    selectedSourceCount: input.selectedSourceCount ?? 0,
    normalizedEpsCount: input.normalizedEpsCount ?? 0,
    cacheHits: input.cacheHits ?? 0,
    freshUploads: input.freshUploads ?? 0,
    failedSourceUrls: input.failedSourceUrls ?? [],
    finalSlotOrder: input.finalSlotOrder ?? [],
    provider: input.provider ?? null,
    providerAttempted: input.providerAttempted ?? null,
    providerUsed: input.providerUsed ?? null,
    mediaApiAttempted: input.mediaApiAttempted ?? false,
    mediaApiResultCode: input.mediaApiResultCode ?? null,
    tradingFallbackAttempted: input.tradingFallbackAttempted ?? false,
    tradingFallbackResultCode: input.tradingFallbackResultCode ?? null,
    blockingReason: input.blockingReason ?? null,
  };
}

function applyNormalizationToPayload(
  payload: Record<string, unknown>,
  orderedEpsImages: Array<NormalizableImage & { epsUrl: string }>
): Record<string, unknown> {
  const media = objectOrNull(payload.media) ?? {};
  const audit = objectOrNull(media.audit) ?? {};
  return {
    ...payload,
    images: orderedEpsImages.map((image) => image.epsUrl),
    media: {
      ...media,
      images: orderedEpsImages.map((image, index) => ({
        url: image.epsUrl,
        kind: image.kind ?? "other",
        rank: image.rank ?? index + 1,
        source: image.source ?? "supplier",
        fingerprint: image.fingerprint ?? null,
        hostingMode: "eps",
        reasons: image.reasons,
      })),
      audit: {
        ...audit,
        imageHostingMode: "eps",
        mixedImageHostingModesDropped: false,
        selectedImageUrls: orderedEpsImages.map((image) => image.epsUrl),
      },
    },
  };
}

function applyNormalizationToResponse(
  response: Record<string, unknown> | null,
  orderedEpsImages: Array<NormalizableImage & { epsUrl: string }>,
  diagnostics: EbayImageNormalizationStatus
): Record<string, unknown> {
  const current = response ?? {};
  const currentOrder = Array.isArray(current.imageOrder) ? current.imageOrder : [];
  const imageOrder =
    currentOrder.length === orderedEpsImages.length
      ? currentOrder.map((entry, index) => ({
          ...(objectOrNull(entry) ?? {}),
          hostingMode: "eps",
          url: orderedEpsImages[index]?.epsUrl ?? stringOrNull(objectOrNull(entry)?.url),
        }))
      : orderedEpsImages.map((image, index) => ({
          rank: image.rank ?? index + 1,
          kind: image.kind ?? "other",
          source: image.source ?? "supplier",
          hostingMode: "eps" satisfies EbayHostedImageMode,
          url: image.epsUrl,
        }));

  return {
    ...current,
    imageOrder,
    imageNormalization: diagnostics,
  };
}

export async function normalizeEbayListingImages(input: {
  payload: Record<string, unknown>;
  response?: Record<string, unknown> | null;
  providerOverride?: EbayImageHostingProvider;
}): Promise<NormalizeEbayListingImagesResult> {
  const selectedImages = readSelectedImages(input.payload);
  if (selectedImages.length === 0) {
    const diagnostics = buildDiagnostics("IMAGE_NORMALIZATION_EMPTY_BLOCKED", false, {
      blockingReason: "No final ranked eBay images were available for EPS normalization.",
    });
    return {
      ok: false,
      payload: input.payload,
      response: applyNormalizationToResponse(input.response ?? null, [], diagnostics),
      diagnostics,
    };
  }

  const deduped: NormalizableImage[] = [];
  const seen = new Set<string>();
  for (const image of selectedImages) {
    const url = stringOrNull(image.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    deduped.push(image);
  }

  const failedSourceUrls: string[] = [];
  const orderedEpsImages: Array<NormalizableImage & { epsUrl: string }> = [];
  let cacheHits = 0;
  let freshUploads = 0;
  let providerUsed: string | null = null;
  let providerAttempted: string | null = null;
  let mediaApiAttempted = false;
  let mediaApiResultCode: EbayImageNormalizationCode | null = null;
  let tradingFallbackAttempted = false;
  let tradingFallbackResultCode: EbayImageNormalizationCode | null = null;

  for (const image of deduped.slice(0, 24)) {
    const normalized = await normalizeImageFromUrl(image.url, input.providerOverride);
    providerUsed = normalized.providerUsed;
    providerAttempted = normalized.providerAttempted;
    mediaApiAttempted = mediaApiAttempted || normalized.mediaApiAttempted;
    mediaApiResultCode = normalized.mediaApiResultCode ?? mediaApiResultCode;
    tradingFallbackAttempted = tradingFallbackAttempted || normalized.tradingFallbackAttempted;
    tradingFallbackResultCode = normalized.tradingFallbackResultCode ?? tradingFallbackResultCode;
    if (!normalized.ok || !normalized.epsUrl || classifyHostedImage(normalized.epsUrl) !== "eps") {
      failedSourceUrls.push(image.url);
      const diagnostics = buildDiagnostics(normalized.code, false, {
        selectedSourceCount: deduped.length,
        normalizedEpsCount: orderedEpsImages.length,
        cacheHits,
        freshUploads,
        failedSourceUrls,
        finalSlotOrder: orderedEpsImages.map((entry) => entry.epsUrl),
        provider: providerUsed,
        providerAttempted,
        providerUsed,
        mediaApiAttempted,
        mediaApiResultCode,
        tradingFallbackAttempted,
        tradingFallbackResultCode,
        blockingReason: normalized.reason ?? "EPS normalization failed for one or more selected images.",
      });
      return {
        ok: false,
        payload: input.payload,
        response: applyNormalizationToResponse(input.response ?? null, orderedEpsImages, diagnostics),
        diagnostics,
      };
    }

    if (normalized.cacheHit) cacheHits += 1;
    else freshUploads += 1;
    orderedEpsImages.push({
      ...image,
      epsUrl: normalized.epsUrl,
    });
  }

  const code =
    cacheHits === orderedEpsImages.length ? "IMAGE_NORMALIZATION_CACHE_HIT" : "IMAGE_NORMALIZATION_OK";
  const diagnostics = buildDiagnostics(code, true, {
    selectedSourceCount: deduped.length,
    normalizedEpsCount: orderedEpsImages.length,
    cacheHits,
    freshUploads,
    failedSourceUrls,
    finalSlotOrder: orderedEpsImages.map((entry) => entry.epsUrl),
    provider: providerUsed,
    providerAttempted,
    providerUsed,
    mediaApiAttempted,
    mediaApiResultCode,
    tradingFallbackAttempted,
    tradingFallbackResultCode,
    blockingReason: null,
  });

  const payload = applyNormalizationToPayload(input.payload, orderedEpsImages);
  const response = applyNormalizationToResponse(input.response ?? null, orderedEpsImages, diagnostics);
  const media = objectOrNull(payload.media) ?? {};
  const audit = objectOrNull(media.audit) ?? {};
  payload.media = {
    ...media,
    audit: {
      ...audit,
      imageNormalization: diagnostics,
    },
  };

  return {
    ok: true,
    payload,
    response,
    diagnostics,
  };
}

export function makeMockNormalizationProvider(): EbayImageHostingProvider {
  return createMockEbayImageHostingProvider();
}
