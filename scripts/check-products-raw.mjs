import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL_DIRECT or DATABASE_URL");

const sql = postgres(url, { max: 1 });

const rows = await sql`
  select
    id,
    supplier_key,
    supplier_product_id,
    source_url,
    title,
    currency,
    price_min,
    price_max,
    snapshot_ts
  from products_raw
  order by snapshot_ts desc
  limit 10
`;

console.log(JSON.stringify(rows, null, 2));
await sql.end({ timeout: 5 });
