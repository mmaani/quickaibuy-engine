import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
dotenv.config();

const { Client } = pg;

function requiredArg(index: number, name: string): string {
  const value = String(process.argv[index] ?? "").trim();
  if (!value) {
    throw new Error(`missing ${name}. Usage: pnpm exec tsx scripts/fix_single_listing_payload_for_retry.ts <listing_id> <country_name> <country_code>`);
  }
  return value;
}

async function main() {
  const listingId = requiredArg(2, "listing_id");
  const countryName = requiredArg(3, "country_name");
  const countryCode = requiredArg(4, "country_code");

  const client = new Client({
    connectionString: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const result = await client.query(
    `
      WITH image_source AS (
        SELECT COALESCE(mp.image_url, mp.raw_payload->'image'->>'imageUrl') AS image_url
        FROM listings l
        JOIN profitable_candidates pc
          ON pc.id = l.candidate_id
        LEFT JOIN marketplace_prices mp
          ON mp.marketplace_key = pc.marketplace_key
         AND mp.marketplace_listing_id = pc.marketplace_listing_id
        WHERE l.id = $1
        ORDER BY mp.snapshot_ts DESC NULLS LAST
        LIMIT 1
      )
      UPDATE listings l
      SET
        status = 'PREVIEW',
        updated_at = NOW(),
        payload = jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(l.payload, '{}'::jsonb),
              '{shipFromCountry}',
              to_jsonb($2::text),
              true
            ),
            '{source,supplierWarehouseCountry}',
            to_jsonb($3::text),
            true
          ),
          '{images}',
          CASE
            WHEN (SELECT image_url FROM image_source) IS NOT NULL
            THEN to_jsonb(ARRAY[(SELECT image_url FROM image_source)])
            ELSE COALESCE(l.payload->'images', '[]'::jsonb)
          END,
          true
        )
      WHERE l.id = $1
      RETURNING
        l.id,
        l.status,
        l.payload->>'shipFromCountry' AS ship_from_country,
        l.payload->'source'->>'supplierWarehouseCountry' AS supplier_warehouse_country,
        l.payload->'images' AS images
    `,
    [listingId, countryCode, countryName]
  );

  console.table(result.rows);
  console.log(`rowsUpdated=${result.rowCount}`);

  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
