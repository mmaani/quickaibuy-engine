import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeSupplierKey(value: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "cj dropshipping" ? "cjdropshipping" : normalized;
}

function normalizeCountryCode(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  if (normalized === "USA" || normalized === "UNITED STATES") return "US";
  if (normalized === "CHINA") return "CN";
  return null;
}

function deriveConfidenceFromSignal(signal: string | null, explicitConfidence: number | null): number {
  if (explicitConfidence != null) return explicitConfidence;
  if (signal === "DIRECT" || signal === "PRESENT") return 0.78;
  if (signal === "PARTIAL" || signal === "INFERRED") return 0.58;
  return 0.4;
}

function extractShippingSnapshotDetails(
  shippingEstimates: unknown,
  rawPayload: unknown
): {
  shippingCost: number | null;
  originCountry: string | null;
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  confidence: number;
  sourceType: string;
} {
  const payload = asObject(rawPayload) ?? {};
  const rawSignal = String(payload.shippingSignal ?? "").trim().toUpperCase() || null;
  const rawConfidence = toNum(payload.shippingConfidence);
  const rawOriginCountry =
    normalizeCountryCode(payload.shipFromCountry) ??
    normalizeCountryCode(payload.ship_from_country) ??
    normalizeCountryCode(payload.supplierWarehouseCountry) ??
    normalizeCountryCode(payload.supplier_warehouse_country);
  const rawMinDays = toNum(payload.deliveryEstimateMinDays);
  const rawMaxDays = toNum(payload.deliveryEstimateMaxDays);

  const candidates = Array.isArray(shippingEstimates)
    ? shippingEstimates
    : asObject(shippingEstimates)
      ? [shippingEstimates]
      : [];

  let shippingCost: number | null = null;
  let originCountry = rawOriginCountry;
  let estimatedMinDays = rawMinDays;
  let estimatedMaxDays = rawMaxDays;

  for (const candidate of candidates) {
    const item = asObject(candidate);
    if (!item) continue;
    const cost = toNum(item.cost ?? item.shippingCost ?? item.price);
    const label = String(item.label ?? "").trim().toLowerCase();
    const minDays = toNum(item.etaMinDays ?? item.estimatedMinDays);
    const maxDays = toNum(item.etaMaxDays ?? item.estimatedMaxDays);
    const shipFromCountry = normalizeCountryCode(item.ship_from_country ?? item.shipFromCountry);
    if (shippingCost == null && cost != null && cost >= 0) shippingCost = cost;
    if (estimatedMinDays == null && minDays != null) estimatedMinDays = minDays;
    if (estimatedMaxDays == null && maxDays != null) estimatedMaxDays = maxDays;
    if (originCountry == null && shipFromCountry) originCountry = shipFromCountry;
    if (shippingCost != null && estimatedMinDays != null && estimatedMaxDays != null && originCountry != null) {
      break;
    }
    if (shippingCost == null && label.includes("free shipping")) {
      shippingCost = 0;
    }
  }

  const confidence = deriveConfidenceFromSignal(rawSignal, rawConfidence);
  const sourceType =
    shippingCost != null ? "supplier_snapshot" : rawSignal ? "supplier_signal_seed" : "fallback_seed";

  return {
    shippingCost,
    originCountry,
    estimatedMinDays,
    estimatedMaxDays,
    confidence,
    sourceType,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const destinationCountry = String(process.env.DEFAULT_PRICING_DESTINATION ?? "US").toUpperCase();
  const defaultShippingUsd = Math.max(0, toNum(process.env.DEFAULT_SUPPLIER_SHIPPING_USD) ?? 6.99);

  const products = await db.execute<{
    supplierKey: string;
    supplierProductId: string;
    shippingEstimates: unknown;
    rawPayload: unknown;
  }>(sql`
    SELECT DISTINCT ON (lower(supplier_key), supplier_product_id)
      lower(supplier_key) AS "supplierKey",
      supplier_product_id AS "supplierProductId",
      shipping_estimates AS "shippingEstimates",
      raw_payload AS "rawPayload"
    FROM products_raw
    WHERE supplier_key IS NOT NULL
      AND supplier_product_id IS NOT NULL
    ORDER BY lower(supplier_key), supplier_product_id, snapshot_ts DESC
    LIMIT 500
  `);

  let prepared = 0;
  let inserted = 0;

  for (const row of products.rows ?? []) {
    prepared++;
    const snapshot = extractShippingSnapshotDetails(row.shippingEstimates, row.rawPayload);
    const shippingCost = snapshot.shippingCost ?? defaultShippingUsd;

    if (!apply) continue;

    await db.execute(sql`
      INSERT INTO supplier_shipping_quotes (
        supplier_key,
        supplier_product_id,
        origin_country,
        destination_country,
        service_level,
        shipping_cost,
        estimated_min_days,
        estimated_max_days,
        currency,
        confidence,
        source_type,
        last_verified_at,
        updated_at
      ) VALUES (
        ${normalizeSupplierKey(row.supplierKey)},
        ${row.supplierProductId},
        ${snapshot.originCountry},
        ${destinationCountry},
        'STANDARD',
        ${String(shippingCost)},
        ${snapshot.estimatedMinDays != null ? String(snapshot.estimatedMinDays) : null},
        ${snapshot.estimatedMaxDays != null ? String(snapshot.estimatedMaxDays) : null},
        'USD',
        ${String(snapshot.confidence)},
        ${snapshot.sourceType},
        now(),
        now()
      )
      ON CONFLICT (supplier_key, supplier_product_id, destination_country, service_level)
      DO UPDATE SET
        origin_country = EXCLUDED.origin_country,
        shipping_cost = EXCLUDED.shipping_cost,
        estimated_min_days = EXCLUDED.estimated_min_days,
        estimated_max_days = EXCLUDED.estimated_max_days,
        confidence = EXCLUDED.confidence,
        source_type = EXCLUDED.source_type,
        last_verified_at = EXCLUDED.last_verified_at,
        updated_at = now()
    `);

    inserted++;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply,
        prepared,
        inserted,
        destinationCountry,
        defaultShippingUsd,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("backfill_shipping_intelligence failed", error);
  process.exit(1);
});
