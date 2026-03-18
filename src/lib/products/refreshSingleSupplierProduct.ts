import {
  getLatestProductRawBySupplierProduct,
  insertProductRawReturningId,
} from "@/lib/db/productsRaw";
import { supplierProductToRawInsert } from "@/lib/products/supplierSnapshots";
import { normalizeAvailabilitySignal } from "@/lib/products/supplierAvailability";
import { classifySupplierSnapshotQuality } from "@/lib/products/supplierQuality";
import { searchAlibabaByKeyword } from "@/lib/products/suppliers/alibaba";
import { searchAliExpressByKeyword } from "@/lib/products/suppliers/aliexpress";
import { searchTemuByKeyword } from "@/lib/products/suppliers/temu";
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
  keyword: string
): Promise<{ product: SupplierProduct; refreshMode: string }> {
  const rows = await searchAliExpressByKeyword(keyword, 20);
  const exact =
    rows.find((row) => String(row.supplierProductId ?? "").trim() === current.supplierProductId) ?? null;

  if (exact) {
    return {
      product: {
        ...exact,
        supplierProductId: current.supplierProductId,
      },
      refreshMode: "exact-match",
    };
  }

  return {
    product: buildAliExpressSyntheticRefreshRow(current, keyword, rows),
    refreshMode: "synthetic-refresh",
  };
}

async function refreshSupplierSingleProduct(input: {
  current: NonNullable<LatestSupplierSnapshot>;
  keyword: string;
  supplierKey: string;
}): Promise<{ product: SupplierProduct; refreshMode: string }> {
  const { current, keyword, supplierKey } = input;

  if (supplierKey === "aliexpress") {
    return refreshAliExpressSingleProduct(current, keyword);
  }

  if (supplierKey === "temu") {
    const rows = await searchTemuByKeyword(keyword, 20);
    const exact =
      rows.find((row) => String(row.supplierProductId ?? "").trim() === current.supplierProductId) ?? null;

    if (exact) {
      return {
        product: {
          ...exact,
          supplierProductId: current.supplierProductId,
        },
        refreshMode: "exact-match",
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
    };
  }

  if (supplierKey === "alibaba") {
    const rows = await searchAlibabaByKeyword(keyword, 20);
    const exact =
      rows.find((row) => String(row.supplierProductId ?? "").trim() === current.supplierProductId) ?? null;

    if (exact) {
      return {
        product: {
          ...exact,
          supplierProductId: current.supplierProductId,
        },
        refreshMode: "exact-match",
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
    };
  }

  return {
    product: buildSyntheticRefreshRow({
      current,
      keyword,
      fetchedRows: [],
      platform: "AliExpress",
      provider: `${supplierKey}-single-refresh`,
    }),
    refreshMode: "unsupported-supplier",
  };
}

export async function refreshSingleSupplierProduct(input: {
  supplierKey: string;
  supplierProductId: string;
}): Promise<SingleSupplierRefreshResult> {
  const supplierKey = String(input.supplierKey ?? "").trim().toLowerCase();
  const supplierProductId = String(input.supplierProductId ?? "").trim();
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
    };
  }

  if (!["aliexpress", "temu", "alibaba"].includes(supplierKey)) {
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
    };
  }

  const refreshed = await refreshSupplierSingleProduct({ current, keyword, supplierKey });
  const insertedId = await insertProductRawReturningId(supplierProductToRawInsert(refreshed.product));
  const availabilityStatus = normalizeAvailabilitySignal(
    refreshed.product.availabilitySignal ?? refreshed.product.raw?.availabilitySignal
  );
  const snapshotQuality = classifySupplierSnapshotQuality({
    rawPayload: refreshed.product.raw,
    availabilitySignal: refreshed.product.availabilitySignal,
    availabilityConfidence: refreshed.product.availabilityConfidence,
    price: refreshed.product.price,
    title: refreshed.product.title,
    sourceUrl: refreshed.product.sourceUrl,
    images: refreshed.product.images,
    shippingEstimates: refreshed.product.shippingEstimates,
  });
  const proceed = shouldProceedWithReevaluation(snapshotQuality, availabilityStatus);

  return {
    refreshed: true,
    supplierKey,
    supplierProductId,
    previousSnapshotId: String(current.id),
    refreshedSnapshotId: insertedId,
    availabilityStatus,
    snapshotQuality,
    reevaluationReady: proceed.ready,
    blockerReason: proceed.blockerReason,
    sourceUrl: refreshed.product.sourceUrl,
    title: refreshed.product.title,
    refreshMode: refreshed.refreshMode,
  };
}
