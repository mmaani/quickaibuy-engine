import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const supplierDuplicates = await client.query(`
    SELECT
      LOWER(pc.supplier_key) AS supplier_key,
      pc.supplier_product_id,
      l.marketplace_key,
      COUNT(*)::int AS listing_count,
      ARRAY_AGG(l.id::text ORDER BY l.updated_at DESC NULLS LAST) AS listing_ids,
      ARRAY_AGG(l.status ORDER BY l.updated_at DESC NULLS LAST) AS statuses
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    WHERE l.status IN ('PREVIEW', 'READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE')
    GROUP BY LOWER(pc.supplier_key), pc.supplier_product_id, l.marketplace_key
    HAVING COUNT(*) > 1
    ORDER BY listing_count DESC, supplier_key, supplier_product_id
    LIMIT 100
  `);

  const titleDuplicates = await client.query(`
    WITH fp AS (
      SELECT
        l.id,
        l.marketplace_key,
        l.status,
        REGEXP_REPLACE(LOWER(COALESCE(l.title, '')), '[^a-z0-9]+', '', 'g') AS title_fp
      FROM listings l
      WHERE l.status IN ('PREVIEW', 'READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE')
    )
    SELECT
      marketplace_key,
      title_fp,
      COUNT(*)::int AS listing_count,
      ARRAY_AGG(id::text) AS listing_ids,
      ARRAY_AGG(status) AS statuses
    FROM fp
    WHERE title_fp <> ''
    GROUP BY marketplace_key, title_fp
    HAVING COUNT(*) > 1
    ORDER BY listing_count DESC
    LIMIT 100
  `);

  console.log("Supplier-product duplicate groups:");
  console.table(supplierDuplicates.rows);
  console.log(`supplier-product duplicate groups: ${supplierDuplicates.rows.length}`);

  console.log("Title-fingerprint duplicate groups:");
  console.table(titleDuplicates.rows);
  console.log(`title-fingerprint duplicate groups: ${titleDuplicates.rows.length}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
