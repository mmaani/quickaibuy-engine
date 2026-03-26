import {
  getLatestProductRawBySupplierProduct,
  insertProductRawReturningId,
  updateProductRawById,
} from "@/lib/db/productsRaw";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { supplierProductToRawInsert } from "@/lib/products/supplierSnapshots";
import { normalizeAvailabilitySignal } from "@/lib/products/supplierAvailability";
import { classifySupplierSnapshotQuality } from "@/lib/products/supplierQuality";
import { searchAlibabaByKeyword } from "@/lib/products/suppliers/alibaba";
import { searchAliExpressByKeyword } from "@/lib/products/suppliers/aliexpress";
import { searchTemuByKeyword } from "@/lib/products/suppliers/temu";
import { fetchCjDirectProduct } from "@/lib/products/suppliers/cjdropshipping";
import type { SupplierProduct } from "@/lib/products/suppliers/types";

type LatestSupplierSnapshot = Awaited<ReturnType<typeof getLatestProductRawBySupplierProduct>>;

export type SingleSupplierRefreshResult = {
  refreshed: boolean;
  supplierKey: string;
  supplierProductId: string;
  previousSnapshotId: string | null;
  refreshedSnapshotId: string | null;
  availabilityStatus: string;
  snapshotQuality: string;
  reevaluationReady: boolean;
  blockerReason: string | null;
  sourceUrl: string | null;
  title: string | null;
  refreshMode: string;
  exactMatchFound: boolean;
};

function parseSearchTextFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const query = parsed.searchParams.get("SearchText") ?? parsed.searchParams.get("search_key");
    return query?.trim() || null;
  } catch {
    return null;
  }
}

function deriveKeyword(row: NonNullable<LatestSupplierSnapshot>): string | null {
  const payload =
    row.rawPayload && typeof row.rawPayload === "object" && !Array.isArray(row.rawPayload)
      ? (row.rawPayload as Record<string, unknown>)
      : {};
  const payloadKeyword = String(payload.keyword ?? "").trim();
  if (payloadKeyword) return payloadKeyword;

  const fromUrl = parseSearchTextFromUrl(row.sourceUrl);
  if (fromUrl) return fromUrl;

  const title = String(row.title ?? "")
    .replace(/\s+sample from (AliExpress|Temu|Alibaba)$/i, "")
    .trim();
  return title || null;
}

function shouldProceedWithReevaluation(snapshotQuality: string, availabilityStatus: string): {
  ready: boolean;
  blockerReason: string | null;
} {
  const quality = String(snapshotQuality).toUpperCase();
  const availability = normalizeAvailabilitySignal(availabilityStatus);

  if (availability === "OUT_OF_STOCK") {
    return { ready: false, blockerReason: "supplier availability indicates out of stock" };
  }
  if (availability === "UNKNOWN" || availability === "LOW_STOCK") {
    return {
      ready: false,
      blockerReason: `supplier availability requires manual review (${availability})`,
    };
  }
  if (quality === "STUB" || quality === "LOW") {
    return {
      ready: false,
      blockerReason: `supplier snapshot quality remains ${quality}`,
    };
  }

  return { ready: true, blockerReason: null };
}

function buildSyntheticRefreshRow(input: {
  current: NonNullable<LatestSupplierSnapshot>;
  keyword: string;
  fetchedRows: SupplierProduct[];
  platform: SupplierProduct["platform"];
  provider: string;
}): SupplierProduct {
  const { current, keyword, fetchedRows, platform, provider } = input;
  const parsedRows = fetchedRows.filter((row) => String(row.raw?.crawlStatus ?? "").toUpperCase() === "PARSED");
  const sample = parsedRows[0] ?? fetchedRows[0] ?? null;
  const snapshotTs = new Date().toISOString();

  return {
    title: current.title ?? sample?.title ?? `${keyword} sample from ${platform}`,
    price: current.priceMin != null ? String(current.priceMin) : sample?.price ?? null,
    currency: current.currency ?? sample?.currency ?? "USD",
    images: Array.isArray(current.images) ? current.images.filter((v) => typeof v === "string") as string[] : [],
    variants: Array.isArray(current.variants) ? current.variants as [] : [],
    sourceUrl: current.sourceUrl ?? sample?.sourceUrl ?? "",
    supplierProductId: current.supplierProductId,
    shippingEstimates: Array.isArray(current.shippingEstimates)
      ? current.shippingEstimates
      : [],
    platform,
    keyword,
    snapshotTs,
    availabilitySignal: normalizeAvailabilitySignal(
      sample?.availabilitySignal ?? sample?.raw?.availabilitySignal
    ),
    availabilityConfidence:
      typeof sample?.availabilityConfidence === "number"
        ? sample.availabilityConfidence
        : parsedRows.length > 0
          ? 0.2
          : 0.12,
    snapshotQuality: parsedRows.length > 0 ? "LOW" : "STUB",
    telemetrySignals: parsedRows.length > 0 ? ["parsed", "low_quality"] : ["fallback", "low_quality"],
    raw: {
      provider,
      refreshMode: parsedRows.length > 0 ? "search-page-no-exact-match" : "no-products-parsed",
      keyword,
      sourceUrl: current.sourceUrl,
      crawlStatus: parsedRows.length > 0 ? "RELATED_PRODUCTS_PARSED" : "NO_PRODUCTS_PARSED",
      availabilitySignal: normalizeAvailabilitySignal(
        sample?.availabilitySignal ?? sample?.raw?.availabilitySignal
      ),
      availabilityConfidence:
        typeof sample?.availabilityConfidence === "number"
          ? sample.availabilityConfidence
          : parsedRows.length > 0
            ? 0.2
            : 0.12,
      availabilityEvidencePresent: Boolean(sample?.raw?.availabilityEvidencePresent),
      availabilityEvidenceQuality: sample?.raw?.availabilityEvidenceQuality ?? "LOW",
      pageProductCount: parsedRows.length,
      matchedExactSupplierProductId: false,
      sampleParsedSupplierProductId: sample?.supplierProductId ?? null,
      sampleParsedTitle: sample?.title ?? null,
      sampleParsedSourceUrl: sample?.sourceUrl ?? null,
      telemetrySignals: parsedRows.length > 0 ? ["parsed", "low_quality"] : ["fallback", "low_quality"],
    },
  };
}

function buildAliExpressSyntheticRefreshRow(
  current: NonNullable<LatestSupplierSnapshot>,
  keyword: string,
  fetchedRows: SupplierProduct[]
): SupplierProduct {
  return buildSyntheticRefreshRow({
    current,
    keyword,
    fetchedRows,
    platform: "AliExpress",
    provider: "aliexpress-single-refresh",
  });
}

async function refreshAliExpressSingleProduct(
  current: NonNullable<LatestSupplierSnapshot>,
  keyword: string,
  limit: number,
  allowSyntheticFallback: boolean
): Promise<{ product: SupplierProduct | null; refreshMode: string; exactMatchFound: boolean }> {
  const searchTerms = Array.from(
    new Set(
      [keyword, String(current.title ?? "").trim()]
        .map((value) => value.trim())
        .filter((value) => value.length >= 3)
    )
  ).slice(0, 3);

  for (const searchTerm of searchTerms) {
    const rows = await searchAliExpressByKeyword(searchTerm, limit);
    const exact =
      rows.find((row) => String(row.supplierProductId ?? "").trim() === current.supplierProductId) ?? null;

    if (exact) {
      return {
        product: {
          ...exact,
          supplierProductId: current.supplierProductId,
        },
        refreshMode: searchTerm === keyword ? "exact-match" : "exact-match-title-search",
        exactMatchFound: true,
      };
    }

    if (allowSyntheticFallback && rows.length) {
      return {
        product: buildAliExpressSyntheticRefreshRow(current, searchTerm, rows),
        refreshMode: "synthetic-refresh",
        exactMatchFound: false,
      };
    }
  }

  return {
    product: null,
    refreshMode: "exact-match-not-found",
    exactMatchFound: false,
  };
}

async function refreshSupplierSingleProduct(input: {
  current: NonNullable<LatestSupplierSnapshot>;
  keyword: string;
  supplierKey: string;
  searchLimit?: number;
  allowSyntheticFallback?: boolean;
}): Promise<{ product: SupplierProduct | null; refreshMode: string; exactMatchFound: boolean }> {
  const { current, keyword, supplierKey } = input;
  const searchLimit = Math.max(20, Math.min(Number(input.searchLimit ?? 60), 100));
  const allowSyntheticFallback = Boolean(input.allowSyntheticFallback);

  if (supplierKey === "aliexpress") {
    return refreshAliExpressSingleProduct(current, keyword, searchLimit, allowSyntheticFallback);
  }

  if (supplierKey === "temu") {
    const rows = await searchTemuByKeyword(keyword, searchLimit);
    const exact =
      rows.find((row) => String(row.supplierProductId ?? "").trim() === current.supplierProductId) ?? null;

    if (exact) {
      return {
        product: {
          ...exact,
          supplierProductId: current.supplierProductId,
        },
        refreshMode: "exact-match",
        exactMatchFound: true,
      };
    }

    if (!allowSyntheticFallback) {
      return {
        product: null,
        refreshMode: "exact-match-not-found",
        exactMatchFound: false,
      };
    }

    return {
      product: buildSyntheticRefreshRow({
        current,
        keyword,
        fetchedRows: rows,
        platform: "Temu",
        provider: "temu-single-refresh",
      }),
      refreshMode: "synthetic-refresh",
      exactMatchFound: false,
    };
  }

  if (supplierKey === "alibaba") {
    const rows = await searchAlibabaByKeyword(keyword, searchLimit);
    const exact =
      rows.find((row) => String(row.supplierProductId ?? "").trim() === current.supplierProductId) ?? null;

    if (exact) {
      return {
        product: {
          ...exact,
          supplierProductId: current.supplierProductId,
        },
        refreshMode: "exact-match",
        exactMatchFound: true,
      };
    }

    if (!allowSyntheticFallback) {
      return {
        product: null,
        refreshMode: "exact-match-not-found",
        exactMatchFound: false,
      };
    }

    return {
      product: buildSyntheticRefreshRow({
        current,
        keyword,
        fetchedRows: rows,
        platform: "Alibaba",
        provider: "alibaba-single-refresh",
      }),
      refreshMode: "synthetic-refresh",
      exactMatchFound: false,
    };
  }

  if (supplierKey === "cjdropshipping" || supplierKey === "cj dropshipping") {
    if (!current.sourceUrl) {
      return {
        product: null,
        refreshMode: "missing-source-url",
        exactMatchFound: false,
      };
    }

    const direct = await fetchCjDirectProduct(current.sourceUrl);
    return {
      product: direct.product,
      refreshMode: "direct-product-refresh",
      exactMatchFound: true,
    };
  }

  return {
    product: null,
    refreshMode: "unsupported-supplier",
    exactMatchFound: false,
  };
}

export async function refreshSingleSupplierProduct(input: {
  supplierKey: string;
  supplierProductId: string;
  requireExactMatch?: boolean;
  searchLimit?: number;
  updateExisting?: boolean;
}): Promise<SingleSupplierRefreshResult> {
  const supplierKey = String(input.supplierKey ?? "").trim().toLowerCase();
  const supplierProductId = String(input.supplierProductId ?? "").trim();
  const requireExactMatch = input.requireExactMatch !== false;
  const updateExisting = input.updateExisting !== false;
  const current = await getLatestProductRawBySupplierProduct({
    supplierKey,
    supplierProductId,
  });

  if (!current) {
    return {
      refreshed: false,
      supplierKey,
      supplierProductId,
      previousSnapshotId: null,
      refreshedSnapshotId: null,
      availabilityStatus: "UNKNOWN",
      snapshotQuality: "STUB",
      reevaluationReady: false,
      blockerReason: "existing supplier snapshot not found",
      sourceUrl: null,
      title: null,
      refreshMode: "not-found",
      exactMatchFound: false,
    };
  }

  if (!["aliexpress", "temu", "alibaba", "cjdropshipping", "cj dropshipping"].includes(supplierKey)) {
    return {
      refreshed: false,
      supplierKey,
      supplierProductId,
      previousSnapshotId: String(current.id),
      refreshedSnapshotId: null,
      availabilityStatus: normalizeAvailabilitySignal(current.availabilityStatus),
      snapshotQuality:
        classifySupplierSnapshotQuality({
          rawPayload: current.rawPayload,
          availabilitySignal: current.availabilityStatus,
          price: current.priceMin,
          title: current.title,
          sourceUrl: current.sourceUrl,
          images: current.images,
          shippingEstimates: current.shippingEstimates,
        }) ?? "STUB",
      reevaluationReady: false,
      blockerReason: `single-product refresh is not implemented for supplier_key=${supplierKey}`,
      sourceUrl: current.sourceUrl,
      title: current.title,
      refreshMode: "unsupported-supplier",
      exactMatchFound: false,
    };
  }

  const keyword = deriveKeyword(current);
  if (!keyword) {
    return {
      refreshed: false,
      supplierKey,
      supplierProductId,
      previousSnapshotId: String(current.id),
      refreshedSnapshotId: null,
      availabilityStatus: normalizeAvailabilitySignal(current.availabilityStatus),
      snapshotQuality: classifySupplierSnapshotQuality({
        rawPayload: current.rawPayload,
        availabilitySignal: current.availabilityStatus,
        price: current.priceMin,
        title: current.title,
        sourceUrl: current.sourceUrl,
        images: current.images,
        shippingEstimates: current.shippingEstimates,
      }),
      reevaluationReady: false,
      blockerReason: "unable to derive supplier refresh keyword from latest snapshot",
      sourceUrl: current.sourceUrl,
      title: current.title,
      refreshMode: "missing-keyword",
      exactMatchFound: false,
    };
  }

  const refreshed = await refreshSupplierSingleProduct({
    current,
    keyword,
    supplierKey,
    searchLimit: input.searchLimit,
    allowSyntheticFallback: !requireExactMatch,
  });
  if (!refreshed.product) {
    return {
      refreshed: false,
      supplierKey,
      supplierProductId,
      previousSnapshotId: String(current.id),
      refreshedSnapshotId: null,
      availabilityStatus: normalizeAvailabilitySignal(current.availabilityStatus),
      snapshotQuality: classifySupplierSnapshotQuality({
        rawPayload: current.rawPayload,
        availabilitySignal: current.availabilityStatus,
        price: current.priceMin,
        title: current.title,
        sourceUrl: current.sourceUrl,
        images: current.images,
        shippingEstimates: current.shippingEstimates,
      }),
      reevaluationReady: false,
      blockerReason: requireExactMatch
        ? `exact supplier row could not be re-fetched for supplier_product_id=${supplierProductId}`
        : "refresh did not return a supplier product",
      sourceUrl: current.sourceUrl,
      title: current.title,
      refreshMode: refreshed.refreshMode,
      exactMatchFound: refreshed.exactMatchFound,
    };
  }

  const refreshedProduct: SupplierProduct = {
    ...refreshed.product,
    raw: {
      ...refreshed.product.raw,
      refreshMode: refreshed.refreshMode,
      refreshExactMatchFound: refreshed.exactMatchFound,
      previousSnapshotId: String(current.id),
      refreshedFromSupplierProductId: supplierProductId,
      refreshKeyword: keyword,
    },
  };
  const normalizedRefreshRow = supplierProductToRawInsert(refreshedProduct);
  const refreshedSnapshotId = updateExisting
    ? await updateProductRawById(String(current.id), normalizedRefreshRow)
    : await insertProductRawReturningId(normalizedRefreshRow);
  const availabilityStatus = normalizeAvailabilitySignal(
    refreshedProduct.availabilitySignal ?? refreshedProduct.raw?.availabilitySignal
  );
  const snapshotQuality = classifySupplierSnapshotQuality({
    rawPayload: refreshedProduct.raw,
    availabilitySignal: refreshedProduct.availabilitySignal,
    availabilityConfidence: refreshedProduct.availabilityConfidence,
    price: refreshedProduct.price,
    title: refreshedProduct.title,
    sourceUrl: refreshedProduct.sourceUrl,
    images: refreshedProduct.images,
    shippingEstimates: refreshedProduct.shippingEstimates,
  });
  const proceed = shouldProceedWithReevaluation(snapshotQuality, availabilityStatus);

  await writeAuditLog({
    actorType: "WORKER",
    actorId: "supplier:refresh",
    entityType: "PRODUCT_RAW",
    entityId: refreshedSnapshotId,
    eventType: "SUPPLIER_PRODUCT_REFRESHED",
    details: {
      supplierKey,
      supplierProductId,
      previousSnapshotId: String(current.id),
      refreshedSnapshotId,
      refreshMode: refreshed.refreshMode,
      exactMatchFound: refreshed.exactMatchFound,
      sourceUrl: refreshedProduct.sourceUrl,
      title: refreshedProduct.title,
      availabilityStatus,
      snapshotQuality,
      reevaluationReady: proceed.ready,
      blockerReason: proceed.blockerReason,
      updateExisting,
    },
  });

  return {
    refreshed: Boolean(refreshedSnapshotId),
    supplierKey,
    supplierProductId,
    previousSnapshotId: String(current.id),
    refreshedSnapshotId,
    availabilityStatus,
    snapshotQuality,
    reevaluationReady: proceed.ready,
    blockerReason: proceed.blockerReason,
    sourceUrl: refreshedProduct.sourceUrl,
    title: refreshedProduct.title,
    refreshMode: refreshed.refreshMode,
    exactMatchFound: refreshed.exactMatchFound,
  };
}
