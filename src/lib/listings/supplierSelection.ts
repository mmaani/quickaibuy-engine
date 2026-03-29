import { computeSupplierIntelligenceSignal } from "@/lib/suppliers/intelligence";

type SupplierSelectionRow = {
  candidateId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  supplierKey?: unknown;
  supplierProductId?: unknown;
  supplierPrice: unknown;
  marginPct: unknown;
  estimatedProfit: unknown;
  shippingEstimates?: unknown;
  supplierRawPayload: unknown;
};

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseSupplierPayload(row: SupplierSelectionRow): Record<string, unknown> | null {
  return objectOrNull(row.supplierRawPayload);
}

export function computeSupplierSelectionScore(row: SupplierSelectionRow): number {
  const payload = parseSupplierPayload(row);
  const supplierPrice = toPositiveNumber(row.supplierPrice) ?? 0;
  const marginPct = toNum(row.marginPct) ?? 0;
  const mediaQuality = toNum(payload?.mediaQualityScore) ?? 0.5;
  const availabilityConfidence = toNum(payload?.availabilityConfidence) ?? 0.5;
  const shippingMin =
    toPositiveNumber(payload?.deliveryEstimateMinDays) ??
    toPositiveNumber(payload?.delivery_estimate_min_days) ??
    21;
  const shippingMax =
    toPositiveNumber(payload?.deliveryEstimateMaxDays) ??
    toPositiveNumber(payload?.delivery_estimate_max_days) ??
    shippingMin;
  const shippingDays = Math.max(shippingMin, shippingMax);
  const shippingPenalty = Math.min(0.25, shippingDays / 100);
  const priceComponent = supplierPrice > 0 ? Math.min(0.25, 1 / Math.max(1, supplierPrice / 10)) : 0;
  const marginComponent = Math.max(0, Math.min(0.25, marginPct / 200));
  const mediaComponent = Math.max(0, Math.min(0.25, mediaQuality * 0.25));
  const stockReliabilityComponent = Math.max(0, Math.min(0.25, availabilityConfidence * 0.25));
  const intelligence = computeSupplierIntelligenceSignal({
    supplierKey: String(row.supplierKey ?? payload?.supplierKey ?? ""),
    availabilitySignal: payload?.availabilitySignal ?? payload?.availability_status,
    availabilityConfidence,
    shippingEstimates: row.shippingEstimates ?? payload?.shippingEstimates ?? payload?.shipping_estimates,
    rawPayload: payload,
    shippingConfidence: payload?.shippingConfidence ?? payload?.shipping_confidence,
    snapshotQuality: payload?.snapshotQuality ?? payload?.snapshot_quality,
  });
  const supplierIntelligenceComponent = intelligence.reliabilityScore * 0.3;
  const aliExpressPenalty = intelligence.shouldDeprioritize ? 0.18 : 0;

  return Number(
    (
      priceComponent +
      marginComponent +
      mediaComponent +
      stockReliabilityComponent +
      supplierIntelligenceComponent -
      shippingPenalty -
      aliExpressPenalty
    ).toFixed(6)
  );
}

export function selectBestSupplierRowsBeforeListing<T extends SupplierSelectionRow>(rows: T[]): T[] {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.marketplaceKey}:${row.marketplaceListingId}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const selected: T[] = [];
  for (const bucket of grouped.values()) {
    const best = [...bucket].sort((a, b) => {
      const scoreDiff = computeSupplierSelectionScore(b) - computeSupplierSelectionScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      const profitDiff = (toNum(b.estimatedProfit) ?? 0) - (toNum(a.estimatedProfit) ?? 0);
      if (profitDiff !== 0) return profitDiff;
      return String(a.candidateId).localeCompare(String(b.candidateId));
    })[0];
    if (best) selected.push(best);
  }

  return selected;
}
