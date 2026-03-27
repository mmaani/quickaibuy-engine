import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const destinationCountry = String(process.env.DEFAULT_PRICING_DESTINATION ?? "US").toUpperCase();
  const defaultShippingUsd = Math.max(0, toNum(process.env.DEFAULT_SUPPLIER_SHIPPING_USD) ?? 6.99);

  const products = await db.execute<{
    supplierKey: string;
    supplierProductId: string;
    shippingEstimates: unknown;
  }>(sql`
    SELECT DISTINCT ON (lower(supplier_key), supplier_product_id)
      lower(supplier_key) AS "supplierKey",
      supplier_product_id AS "supplierProductId",
      shipping_estimates AS "shippingEstimates"
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
    const snapshotShipping =
      row.shippingEstimates && typeof row.shippingEstimates === "object"
        ? toNum((row.shippingEstimates as Record<string, unknown>).shippingCost)
        : null;
    const shippingCost = snapshotShipping ?? defaultShippingUsd;

    if (!apply) continue;

    await db.execute(sql`
      INSERT INTO supplier_shipping_quotes (
        supplier_key,
        supplier_product_id,
        destination_country,
        service_level,
        shipping_cost,
        currency,
        confidence,
        source_type,
        last_verified_at,
        updated_at
      ) VALUES (
        ${row.supplierKey},
        ${row.supplierProductId},
        ${destinationCountry},
        'STANDARD',
        ${String(shippingCost)},
        'USD',
        ${String(snapshotShipping != null ? 0.55 : 0.4)},
        ${snapshotShipping != null ? "supplier_snapshot" : "fallback_seed"},
        now(),
        now()
      )
      ON CONFLICT (supplier_key, supplier_product_id, destination_country, service_level)
      DO UPDATE SET
        shipping_cost = EXCLUDED.shipping_cost,
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
