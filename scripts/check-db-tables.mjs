import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!url) {
  throw new Error("Missing DATABASE_URL_DIRECT or DATABASE_URL");
}

const sql = postgres(url, { max: 1 });

const rows = await sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
  order by table_name
`;

console.log(rows.map((r) => r.table_name));
await sql.end({ timeout: 5 });
