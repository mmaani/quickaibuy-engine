import { normalizeShipFromCountry } from "@/lib/products/shipFromCountry";
import type { ShippingEstimate } from "@/lib/products/suppliers/types";

export type OriginSource = "explicit" | "inferred" | "weak";
export type OriginValidity = "EXPLICIT" | "STRONG_INFERRED" | "WEAK_OR_UNRESOLVED";

export type OriginEvidence = {
  path: string;
  country: string;
  kind: "ship_from" | "warehouse" | "logistics" | "shipping_estimate" | "variant" | "store";
  weight: number;
};

export type ShipFromResolution = {
  originCountry: string | null;
  warehouseCountry: string | null;
  supplierWarehouseCountry: string | null;
  logisticsOriginHint: string | null;
  originSource: OriginSource;
  originValidity: OriginValidity;
  originConfidence: number;
  evidence: OriginEvidence[];
  unresolvedReason: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function normalizeCountry(value: unknown): string | null {
  return normalizeShipFromCountry(value);
}

function isDestinationCompatible(node: Record<string, unknown>, destinationCountry: string | null): boolean {
  if (!destinationCountry) return true;
  const destination = destinationCountry.toUpperCase();
  const candidateSignals = [
    node.destinationCountry,
    node.destination_country,
    node.shipToCountry,
    node.ship_to_country,
  ]
    .map((value) => normalizeCountry(value))
    .filter((value): value is string => Boolean(value));
  if (!candidateSignals.length) return true;
  return candidateSignals.includes(destination);
}

type Candidate = OriginEvidence & { warehouse: boolean; logistics: boolean };

function weightByPath(path: string): Candidate["kind"] {
  const lower = path.toLowerCase();
  if (lower.includes("warehouse")) return "warehouse";
  if (lower.includes("logistic")) return "logistics";
  if (lower.includes("variant") || lower.includes("sku")) return "variant";
  if (lower.includes("store") || lower.includes("seller")) return "store";
  if (lower.includes("shipping_estimates")) return "shipping_estimate";
  return "ship_from";
}

function baseWeight(kind: Candidate["kind"], path: string): number {
  if (kind === "ship_from") return 0.98;
  if (kind === "warehouse") return 0.95;
  if (kind === "shipping_estimate") return 0.9;
  if (kind === "variant") return 0.88;
  if (kind === "logistics") return 0.82;
  if (kind === "store") return path.toLowerCase().includes("country") ? 0.58 : 0.52;
  return 0.5;
}

function collectFromNode(
  node: unknown,
  path: string,
  destinationCountry: string | null,
  sink: Candidate[],
  depth = 0
): void {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    node.forEach((entry, index) => collectFromNode(entry, `${path}[${index}]`, destinationCountry, sink, depth + 1));
    return;
  }
  const record = asObject(node);
  if (!record) return;
  if (!isDestinationCompatible(record, destinationCountry)) return;

  for (const [key, value] of Object.entries(record)) {
    const nextPath = path ? `${path}.${key}` : key;
    const normalizedKey = key.toLowerCase();
    const isOriginSignal =
      normalizedKey.includes("shipfrom") ||
      normalizedKey.includes("ship_from") ||
      normalizedKey.includes("origin") ||
      normalizedKey.includes("warehouse") ||
      normalizedKey.includes("shipsfrom") ||
      normalizedKey.includes("fromcountry") ||
      normalizedKey.includes("from_country") ||
      normalizedKey.includes("sellercountry") ||
      normalizedKey.includes("storecountry");
    if (isOriginSignal) {
      const country = normalizeCountry(value);
      if (country) {
        const kind = weightByPath(nextPath);
        sink.push({
          path: nextPath,
          country,
          kind,
          weight: baseWeight(kind, nextPath),
          warehouse: kind === "warehouse",
          logistics: kind === "logistics",
        });
      }
    }
    if (Array.isArray(value) || asObject(value)) {
      collectFromNode(value, nextPath, destinationCountry, sink, depth + 1);
    }
  }
}

function collectFromShippingEstimates(estimates: ShippingEstimate[], sink: Candidate[]): void {
  estimates.forEach((estimate, index) => {
    const country = normalizeCountry(estimate.ship_from_country ?? estimate.ship_from_location);
    if (!country) return;
    sink.push({
      path: `shipping_estimates[${index}]`,
      country,
      kind: "shipping_estimate",
      weight: 0.9,
      warehouse: false,
      logistics: false,
    });
  });
}

function strongestCountryByKinds(
  byCountry: Map<string, { weight: number; evidence: OriginEvidence[] }>,
  kinds: OriginEvidence["kind"][]
): string | null {
  const wanted = new Set(kinds);
  const scored = Array.from(byCountry.entries())
    .map(([country, state]) => ({
      country,
      score: state.evidence
        .filter((entry) => wanted.has(entry.kind))
        .reduce((sum, entry) => sum + entry.weight, 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => (right.score === left.score ? left.country.localeCompare(right.country) : right.score - left.score));
  return scored[0]?.country ?? null;
}

export function resolveShipFromOrigin(input: {
  rawPayload?: unknown;
  shippingEstimates?: unknown;
  destinationCountry?: string | null;
}): ShipFromResolution {
  const destinationCountry = normalizeCountry(input.destinationCountry) ?? null;
  const rawPayload = asObject(input.rawPayload) ?? {};
  const shippingEstimates = Array.isArray(input.shippingEstimates)
    ? (input.shippingEstimates as ShippingEstimate[])
    : asObject(input.shippingEstimates)
      ? [input.shippingEstimates as ShippingEstimate]
      : [];
  const candidates: Candidate[] = [];

  collectFromNode(rawPayload, "raw_payload", destinationCountry, candidates);
  collectFromShippingEstimates(shippingEstimates, candidates);

  const byCountry = new Map<string, { weight: number; evidence: OriginEvidence[] }>();
  for (const candidate of candidates) {
    const current = byCountry.get(candidate.country) ?? { weight: 0, evidence: [] };
    current.weight += candidate.weight;
    current.evidence.push({
      path: candidate.path,
      country: candidate.country,
      kind: candidate.kind,
      weight: candidate.weight,
    });
    byCountry.set(candidate.country, current);
  }

  const winner = Array.from(byCountry.entries()).sort((a, b) => {
    if (b[1].weight === a[1].weight) return a[0].localeCompare(b[0]);
    return b[1].weight - a[1].weight;
  })[0];
  const originCountry = winner?.[0] ?? null;
  const winnerWeight = winner?.[1].weight ?? 0;
  const evidence = winner?.[1].evidence ?? [];
  const strongestEvidenceWeight = evidence.reduce((max, entry) => Math.max(max, entry.weight), 0);
  const warehouseCountry = strongestCountryByKinds(byCountry, ["warehouse"]);
  const logisticsOriginHint = strongestCountryByKinds(byCountry, ["logistics", "shipping_estimate", "variant"]);
  const originConfidence = clamp01(
    !originCountry
      ? 0
      : Math.min(
          0.99,
          0.35 + strongestEvidenceWeight * 0.62 + Math.min(0.14, Math.max(0, winnerWeight - strongestEvidenceWeight) * 0.2)
        )
  );
  const originSource: OriginSource =
    originConfidence >= 0.9 ? "explicit" : originConfidence >= 0.75 ? "inferred" : "weak";
  const originValidity: OriginValidity =
    originConfidence >= 0.9 ? "EXPLICIT" : originConfidence >= 0.75 ? "STRONG_INFERRED" : "WEAK_OR_UNRESOLVED";

  return {
    originCountry,
    warehouseCountry,
    supplierWarehouseCountry: warehouseCountry,
    logisticsOriginHint,
    originSource,
    originValidity,
    originConfidence,
    evidence,
    unresolvedReason: originCountry
      ? null
      : candidates.length
        ? "NO_NORMALIZABLE_SHIP_FROM_SIGNAL"
        : "NO_SHIP_FROM_EVIDENCE_FOUND",
  };
}
