import { computeSupplierIntelligenceSignal, shouldRejectSupplierEarly } from "@/lib/suppliers/intelligence";
import { getCjProofBlockingReason, readCjProofStateFromRawPayload } from "@/lib/suppliers/cj";

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
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseSupplierPayload(row: SupplierSelectionRow): Record<string, unknown> | null {
  return objectOrNull(row.supplierRawPayload);
}

export function computeSupplierSelectionScore(row: SupplierSelectionRow): number {
  const payload = parseSupplierPayload(row);
  const normalizedSupplierKey = String(row.supplierKey ?? payload?.supplierKey ?? "").trim().toLowerCase();
  const supplierPrice = toPositiveNumber(row.supplierPrice) ?? 0;
  const marginPct = toNum(row.marginPct) ?? 0;
  const mediaQuality = toNum(payload?.mediaQualityScore) ?? 0.5;
  const availabilityConfidence = toNum(payload?.availabilityConfidence) ?? 0.5;
  const estimatedProfit = toNum(row.estimatedProfit) ?? 0;
  const destinationCountry = "US";
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
  const marginComponent = Math.max(0, Math.min(0.18, marginPct / 220));
  const mediaComponent = Math.max(0, Math.min(0.12, mediaQuality * 0.12));
  const stockReliabilityComponent = Math.max(0, Math.min(0.12, availabilityConfidence * 0.12));
  const trustScore = toNum(payload?.supplierTrustScore ?? payload?.supplier_trust_score);
  const trustBand = String(payload?.supplierTrustBand ?? payload?.supplier_trust_band ?? "")
    .trim()
    .toUpperCase();
  const trustComponent =
    trustScore == null
      ? 0
      : Math.max(0, Math.min(0.22, (trustScore > 1 ? trustScore / 100 : trustScore) * 0.22));
  const trustPenalty = trustBand === "BLOCK" ? 0.2 : trustBand === "REVIEW" ? 0.08 : 0;
  const cjProofState = normalizedSupplierKey === "cjdropshipping" ? readCjProofStateFromRawPayload(payload) : null;
  const cjProofBlockingReason = normalizedSupplierKey === "cjdropshipping" ? getCjProofBlockingReason(cjProofState) : null;
  const intelligence = computeSupplierIntelligenceSignal({
    supplierKey: String(row.supplierKey ?? payload?.supplierKey ?? ""),
    destinationCountry,
    availabilitySignal: payload?.availabilitySignal ?? payload?.availability_status,
    availabilityConfidence,
    shippingEstimates: row.shippingEstimates ?? payload?.shippingEstimates ?? payload?.shipping_estimates,
    rawPayload: payload,
    shippingConfidence: payload?.shippingConfidence ?? payload?.shipping_confidence,
    snapshotQuality: payload?.snapshotQuality ?? payload?.snapshot_quality,
  });
  const earlyReject = shouldRejectSupplierEarly({
    supplierKey: String(row.supplierKey ?? payload?.supplierKey ?? ""),
    destinationCountry,
    availabilitySignal: payload?.availabilitySignal ?? payload?.availability_status,
    availabilityConfidence,
    shippingEstimates: row.shippingEstimates ?? payload?.shippingEstimates ?? payload?.shipping_estimates,
    rawPayload: payload,
    shippingConfidence: payload?.shippingConfidence ?? payload?.shipping_confidence,
    snapshotQuality: payload?.snapshotQuality ?? payload?.snapshot_quality,
    minimumReliabilityScore: 0.58,
    estimatedProfitUsd: estimatedProfit,
    marginPct,
    minimumMarginPct: 18,
    economicsAcceptable: estimatedProfit > 0 && marginPct >= 18,
  });
  if (earlyReject.reject) {
    return Number((-1 - intelligence.reliabilityScore).toFixed(6));
  }
  if (normalizedSupplierKey === "cjdropshipping" && cjProofBlockingReason) {
    return Number((-1.25 - intelligence.reliabilityScore).toFixed(6));
  }
  const supplierIntelligenceComponent = intelligence.reliabilityScore * 0.32;
  const originComponent = intelligence.originAvailabilityRate * 0.18;
  const shippingComponent = intelligence.shippingTransparencyRate * 0.14;
  const usPriorityComponent = intelligence.usMarketPriority * 0.16;
  const rateLimitPenalty = intelligence.rateLimitPressure * 0.14;
  const aliExpressPenalty = intelligence.shouldDeprioritize ? 0.22 : 0;
  const lowStockPenalty = earlyReject.warning ? 0.18 : 0;
  const cjLifecyclePenalty =
    normalizedSupplierKey === "cjdropshipping"
      ? (cjProofState?.orderDetail === "PROVEN" ? 0 : 0.05) + (cjProofState?.tracking === "PROVEN" ? 0 : 0.05)
      : 0;

  return Number(
    (
      priceComponent +
      marginComponent +
      mediaComponent +
      stockReliabilityComponent +
      trustComponent +
      supplierIntelligenceComponent -
      rateLimitPenalty +
      originComponent +
      shippingComponent +
      usPriorityComponent -
      lowStockPenalty -
      cjLifecyclePenalty -
      trustPenalty -
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
