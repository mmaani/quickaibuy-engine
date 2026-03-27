import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute<{
    products: number;
    quotes: number;
    missingQuotes: number;
  }>(sql`
    WITH products AS (
      SELECT DISTINCT lower(supplier_key) AS supplier_key, supplier_product_id
      FROM products_raw
      WHERE supplier_key IS NOT NULL
        AND supplier_product_id IS NOT NULL
    ),
    quotes AS (
      SELECT DISTINCT lower(supplier_key) AS supplier_key, supplier_product_id
      FROM supplier_shipping_quotes
      WHERE upper(destination_country) IN ('US', 'DEFAULT')
    )
    SELECT
      (SELECT COUNT(*)::int FROM products) AS products,
      (SELECT COUNT(*)::int FROM quotes) AS quotes,
      (
        SELECT COUNT(*)::int
        FROM products p
        LEFT JOIN quotes q
          ON q.supplier_key = p.supplier_key
         AND q.supplier_product_id = p.supplier_product_id
        WHERE q.supplier_key IS NULL
      ) AS "missingQuotes"
  `);

  console.log(JSON.stringify({ ok: true, ...(result.rows?.[0] ?? {}) }, null, 2));
}

main().catch((error) => {
  console.error("check_shipping_pricing_readiness failed", error);
  process.exit(1);
});
