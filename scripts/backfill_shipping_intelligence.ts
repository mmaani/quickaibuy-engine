import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { inferShippingFromEvidence } from "@/lib/pricing/shippingInference";

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSupplierKey(value: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "cj dropshipping" ? "cjdropshipping" : normalized;
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
  const inferred = inferShippingFromEvidence({
    supplierKey: "seed",
    destinationCountry: "US",
    shippingEstimates,
    rawPayload,
    defaultShippingUsd: null,
  });

  return {
    shippingCost: inferred.shippingCostUsd,
    originCountry: inferred.originCountry,
    estimatedMinDays: inferred.estimatedMinDays,
    estimatedMaxDays: inferred.estimatedMaxDays,
    confidence: inferred.confidence ?? 0.4,
    sourceType: inferred.sourceType,
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
