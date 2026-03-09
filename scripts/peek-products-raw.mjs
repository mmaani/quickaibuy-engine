import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL_DIRECT or DATABASE_URL");

const sql = postgres(url, { max: 1 });

const rows = await sql`
  select *
  from products_raw
  limit 3
`;

console.log(JSON.stringify(rows, null, 2));
await sql.end({ timeout: 5 });
