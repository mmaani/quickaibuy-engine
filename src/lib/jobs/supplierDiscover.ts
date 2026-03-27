import { getTrendCandidates } from "@/lib/db/trendCandidates";
import { insertProductsRaw } from "@/lib/db/productsRaw";
import {
  buildFocusedSupplierDiscoverKeywords,
  evaluateProductPipelinePolicy,
} from "@/lib/products/pipelinePolicy";
import { searchAliExpressByKeyword } from "@/lib/products/suppliers/aliexpress";
import { searchAlibabaByKeyword } from "@/lib/products/suppliers/alibaba";
import { searchCjByKeyword } from "@/lib/products/suppliers/cjdropshipping";
import { searchTemuByKeyword } from "@/lib/products/suppliers/temu";
import { supplierProductToRawInsert } from "@/lib/products/supplierSnapshots";
import type { SupplierProduct } from "@/lib/products/suppliers/types";

export type SupplierDiscoverResult = {
  processedCandidates: number;
  insertedCount: number;
  scannedProducts: number;
  scoredProducts: number;
  keywords: string[];
  sources: string[];
  sourceBreakdown: SupplierSourceBreakdown[];
};

export type SupplierSourceBreakdown = {
  source: string;
  fetched_count: number;
  parsed_count: number;
  normalized_count: number;
  valid_count: number;
  eligible_count: number;
  dedup_blocked_count: number;
  updated_existing_count: number;
  inserted_new_count: number;
  rejected_missing_required_fields_count: number;
  rejected_quality_count: number;
  rejected_price_count: number;
  rejected_availability_count: number;
  rejected_normalization_count: number;
  rejected_unknown_reason_count: number;
  top_rejection_reasons: string[];
};

type MutableSupplierSourceBreakdown = SupplierSourceBreakdown & {
  rejection_reason_counts: Map<string, number>;
};

const LIGHTWEIGHT_POSITIVE_HINTS = [
  "organizer",
  "pen holder",
  "desk",
  "lamp",
  "night light",
  "mount",
  "fan",
  "storage box",
  "holder",
];

const LIGHTWEIGHT_NEGATIVE_HINTS = [
  "furniture",
  "nightstand",
  "cabinet",
  "wardrobe",
  "chair",
  "table",
  "shelf",
  "bookcase",
];

const SIMPLE_VARIANT_NEGATIVE_HINTS = [
  "set of",
  "bundle",
  "kit",
  "wholesale",
  "custom",
  "personalized",
  "multi size",
  "multi-size",
];

function canonicalSupplierSource(source: string | null | undefined): string {
  const normalized = String(source ?? "").trim().toLowerCase();
  if (normalized === "cj dropshipping" || normalized === "cjdropshipping") return "cjdropshipping";
  if (normalized === "aliexpress" || normalized === "ali_express") return "aliexpress";
  if (normalized === "alibaba") return "alibaba";
  if (normalized === "temu") return "temu";
  return normalized || "unknown";
}

function createSourceBreakdown(source: string): MutableSupplierSourceBreakdown {
  return {
    source,
    fetched_count: 0,
    parsed_count: 0,
    normalized_count: 0,
    valid_count: 0,
    eligible_count: 0,
    dedup_blocked_count: 0,
    updated_existing_count: 0,
    inserted_new_count: 0,
    rejected_missing_required_fields_count: 0,
    rejected_quality_count: 0,
    rejected_price_count: 0,
    rejected_availability_count: 0,
    rejected_normalization_count: 0,
    rejected_unknown_reason_count: 0,
    top_rejection_reasons: [],
    rejection_reason_counts: new Map<string, number>(),
  };
}

function getSourceBreakdown(
  map: Map<string, MutableSupplierSourceBreakdown>,
  source: string | null | undefined
): MutableSupplierSourceBreakdown {
  const key = canonicalSupplierSource(source);
  let current = map.get(key);
  if (!current) {
    current = createSourceBreakdown(key);
    map.set(key, current);
  }
  return current;
}

function bumpRejectionReason(counter: MutableSupplierSourceBreakdown, reason: string) {
  const normalized = String(reason || "unknown").trim() || "unknown";
  counter.rejection_reason_counts.set(normalized, (counter.rejection_reason_counts.get(normalized) ?? 0) + 1);
}

function classifyDropOff(input: {
  item: SupplierProduct;
  normalizedRow: ReturnType<typeof supplierProductToRawInsert>;
  policy: ReturnType<typeof evaluateProductPipelinePolicy>;
}): {
  bucket:
    | "missing_required_fields"
    | "quality"
    | "price"
    | "availability"
    | "normalization"
    | "unknown";
  reason: string;
} | null {
  const { item, normalizedRow, policy } = input;
  const flags = new Set(policy.flags);
  const penalties = new Set(policy.penalties);

  if (!normalizedRow.supplierKey || !normalizedRow.supplierProductId) {
    return { bucket: "normalization", reason: "missing_normalized_supplier_key_or_product_id" };
  }

  if (!normalizedRow.sourceUrl || !normalizedRow.title) {
    return { bucket: "missing_required_fields", reason: "missing_title_or_source_url" };
  }

  if (normalizedRow.priceMin == null && normalizedRow.priceMax == null) {
    return { bucket: "price", reason: "missing_price" };
  }

  if (
    flags.has("WEAK_MEDIA") ||
    flags.has("SUPPLIER_QUALITY_WEAK") ||
    flags.has("SUPPLIER_TELEMETRY_RISK") ||
    item.snapshotQuality === "LOW" ||
    item.snapshotQuality === "STUB"
  ) {
    const crawlStatus = String(item.raw?.crawlStatus ?? "").trim().toUpperCase();
    if (crawlStatus === "CHALLENGE_PAGE") {
      return { bucket: "quality", reason: "challenge_page_fallback" };
    }
    if (crawlStatus === "NO_PRODUCTS_PARSED" || crawlStatus === "FETCH_FAILED") {
      return { bucket: "quality", reason: "fallback_stub_no_products_parsed" };
    }
    return { bucket: "quality", reason: "supplier_quality_or_media_weak" };
  }

  if (
    flags.has("SHIPPING_STABILITY_WEAK") ||
    penalties.has("shipping/availability stability weak")
  ) {
    return { bucket: "availability", reason: "shipping_or_availability_weak" };
  }

  return { bucket: "unknown", reason: "policy_rejected_other" };
}

function shouldPersistParsedSnapshot(input: {
  item: SupplierProduct;
  normalizedRow: ReturnType<typeof supplierProductToRawInsert>;
  policy: ReturnType<typeof evaluateProductPipelinePolicy>;
}): boolean {
  const { item, normalizedRow, policy } = input;
  const crawlStatus = String(item.raw?.crawlStatus ?? "").trim().toUpperCase();
  const telemetry = new Set((item.telemetrySignals ?? []).map((value) => String(value).toLowerCase()));
  const flags = new Set(policy.flags);

  if (crawlStatus !== "PARSED") return false;
  if (telemetry.has("fallback") || telemetry.has("challenge") || telemetry.has("low_quality")) return false;
  if (!normalizedRow.supplierKey || !normalizedRow.supplierProductId) return false;
  if (!normalizedRow.title || !normalizedRow.sourceUrl) return false;
  if (normalizedRow.priceMin == null && normalizedRow.priceMax == null) return false;
  if (!Array.isArray(normalizedRow.images) || normalizedRow.images.length === 0) return false;
  if (flags.has("HARD_EXCLUDE") || flags.has("BRAND_RISK") || flags.has("HIGH_RISK_ELECTRONICS")) return false;

  return true;
}

function isShippingSignalUsable(item: SupplierProduct): boolean {
  const shippingSignal = String(item.raw?.shippingSignal ?? "").trim().toUpperCase();
  const shippingConfidence = typeof item.raw?.shippingConfidence === "number" ? item.raw.shippingConfidence : null;
  const estimates = Array.isArray(item.shippingEstimates) ? item.shippingEstimates : [];
  const hasStructuredEstimate = estimates.some(
    (estimate) =>
      estimate.cost != null ||
      estimate.etaMinDays != null ||
      estimate.etaMaxDays != null ||
      Boolean(estimate.ship_from_country) ||
      Boolean(estimate.label)
  );
  const deliveryMax = estimates.reduce<number | null>(
    (max, estimate) =>
      estimate.etaMaxDays != null ? (max == null ? estimate.etaMaxDays : Math.max(max, estimate.etaMaxDays)) : max,
    null
  );

  if (deliveryMax != null && deliveryMax > 25) return false;
  if (shippingSignal === "MISSING" && !hasStructuredEstimate) return false;
  if (shippingConfidence != null && shippingConfidence < 0.45 && !hasStructuredEstimate) return false;
  return hasStructuredEstimate || shippingSignal === "DIRECT" || shippingSignal === "PARTIAL" || shippingSignal === "INFERRED";
}

function isTargetedDiscoveryFriendly(item: SupplierProduct): boolean {
  const text = `${item.title ?? ""} ${item.keyword ?? ""}`.toLowerCase();
  const hasPositive = LIGHTWEIGHT_POSITIVE_HINTS.some((hint) => text.includes(hint));
  const hasNegative = LIGHTWEIGHT_NEGATIVE_HINTS.some((hint) => text.includes(hint));
  const variantHeavy = SIMPLE_VARIANT_NEGATIVE_HINTS.some((hint) => text.includes(hint));
  const price = item.price ? Number(item.price) : null;
  const imageCount = Array.isArray(item.images) ? item.images.length : 0;
  return (
    hasPositive &&
    !hasNegative &&
    !variantHeavy &&
    imageCount >= 3 &&
    (price == null || price <= 35) &&
    item.availabilitySignal !== "UNKNOWN"
  );
}

export async function runSupplierDiscover(limitPerKeyword = 20): Promise<SupplierDiscoverResult> {
  const candidateLimit = Math.max(
    1,
    Math.min(Number(process.env.SUPPLIER_DISCOVER_CANDIDATE_LIMIT ?? 20), 100)
  );
  const candidates = await getTrendCandidates(candidateLimit, { staleFirst: true });
  const focusedKeywords = buildFocusedSupplierDiscoverKeywords(candidates.map((row) => row.candidate));

  let insertedCount = 0;
  let scannedProducts = 0;
  let scoredProducts = 0;
  const keywords: string[] = [];
  const sources = new Set<string>();
  const sourceBreakdown = new Map<string, MutableSupplierSourceBreakdown>();

  for (const keyword of focusedKeywords) {
    keywords.push(keyword);

    const [cj, aliexpress, alibaba, temu] = await Promise.all([
      searchCjByKeyword(keyword, limitPerKeyword),
      searchAliExpressByKeyword(keyword, limitPerKeyword),
      searchAlibabaByKeyword(keyword, limitPerKeyword),
      searchTemuByKeyword(keyword, limitPerKeyword),
    ]);

    const allProducts = [...cj, ...aliexpress, ...alibaba, ...temu];
    scannedProducts += allProducts.length;

    for (const item of allProducts) {
      const sourceCounter = getSourceBreakdown(sourceBreakdown, item.platform);
      sourceCounter.fetched_count += 1;
      const crawlStatus = String(item.raw?.crawlStatus ?? "").trim().toUpperCase();
      if (crawlStatus === "PARSED") sourceCounter.parsed_count += 1;
    }

    if (!allProducts.length) continue;

    const productsToPersist: SupplierProduct[] = [];
    for (const item of allProducts) {
      const sourceCounter = getSourceBreakdown(sourceBreakdown, item.platform);
      const normalizedRow = supplierProductToRawInsert(item);
      const crawlStatus = String(item.raw?.crawlStatus ?? "").trim().toUpperCase();
      if (normalizedRow.supplierKey && normalizedRow.supplierProductId) {
        sourceCounter.normalized_count += 1;
      }
      const listingValidity = String(item.raw?.listingValidity ?? "").trim().toUpperCase();
      const telemetrySignals = new Set((item.telemetrySignals ?? []).map((value) => String(value).toLowerCase()));
      const hasRequiredFields = Boolean(normalizedRow.title && normalizedRow.sourceUrl);
      if (
        normalizedRow.supplierKey &&
        normalizedRow.supplierProductId &&
        hasRequiredFields &&
        listingValidity !== "INVALID" &&
        crawlStatus === "PARSED" &&
        !telemetrySignals.has("fallback") &&
        !telemetrySignals.has("challenge")
      ) {
        sourceCounter.valid_count += 1;
      }
      const additionalImageCount = Math.max(0, item.images.length - 1);
      const quality = evaluateProductPipelinePolicy({
        title: item.title,
        supplierTitle: item.title,
        imageUrl: item.images[0] ?? null,
        additionalImageCount,
        supplierKey: item.platform,
        supplierQuality: item.snapshotQuality ?? null,
        telemetrySignals: item.telemetrySignals ?? [],
        availabilitySignal: item.availabilitySignal ?? null,
        availabilityConfidence: item.availabilityConfidence ?? null,
        shippingEstimates: item.shippingEstimates,
        supplierPrice: item.price ? Number(item.price) : null,
      });
      item.raw = {
        ...item.raw,
        pipelinePolicy: quality,
      };
      const shippingUsable = isShippingSignalUsable(item);
      const targetedFriendly = isTargetedDiscoveryFriendly(item);
      if (quality.eligible) {
        scoredProducts++;
        sourceCounter.eligible_count += 1;
        productsToPersist.push(item);
      } else {
        const shouldPersist =
          shippingUsable &&
          targetedFriendly &&
          shouldPersistParsedSnapshot({ item, normalizedRow, policy: quality });
        if (shouldPersist) {
          productsToPersist.push(item);
        }
        const dropOff = classifyDropOff({ item, normalizedRow, policy: quality });
        if (dropOff) {
          if (dropOff.bucket === "missing_required_fields") {
            sourceCounter.rejected_missing_required_fields_count += 1;
          } else if (dropOff.bucket === "quality") {
            sourceCounter.rejected_quality_count += 1;
          } else if (dropOff.bucket === "price") {
            sourceCounter.rejected_price_count += 1;
          } else if (dropOff.bucket === "availability") {
            sourceCounter.rejected_availability_count += 1;
          } else if (dropOff.bucket === "normalization") {
            sourceCounter.rejected_normalization_count += 1;
          } else {
            sourceCounter.rejected_unknown_reason_count += 1;
          }
          bumpRejectionReason(sourceCounter, dropOff.reason);
        }
      }
    }

    if (!productsToPersist.length) continue;

    for (const item of productsToPersist) {
      sources.add(item.platform);
    }

    const insertedRows = productsToPersist.map(supplierProductToRawInsert);
    insertedCount += await insertProductsRaw(insertedRows);
    for (const row of insertedRows) {
      getSourceBreakdown(sourceBreakdown, row.supplierKey).inserted_new_count += 1;
    }
  }

  const finalizedSourceBreakdown = Array.from(sourceBreakdown.values())
    .map((row) => ({
      ...row,
      top_rejection_reasons: Array.from(row.rejection_reason_counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([reason]) => reason),
    }))
    .map((row) => {
      const { rejection_reason_counts, ...rest } = row;
      void rejection_reason_counts;
      return rest;
    })
    .sort((a, b) => a.source.localeCompare(b.source));

  return {
    processedCandidates: keywords.length,
    insertedCount,
    scannedProducts,
    scoredProducts,
    keywords,
    sources: Array.from(sources),
    sourceBreakdown: finalizedSourceBreakdown,
  };
}
