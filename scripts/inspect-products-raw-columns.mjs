import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL_DIRECT or DATABASE_URL");

const sql = postgres(url, { max: 1 });

const rows = await sql`
  select
    column_name,
    data_type,
    is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products_raw'
  order by ordinal_position
`;

console.log(JSON.stringify(rows, null, 2));
await sql.end({ timeout: 5 });
