import fs from "fs";
import { Client } from "pg";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = val;
  }

  return true;
}

function ensureSslMode(url) {
  if (!url) return url;
  if (/sslmode=/i.test(url)) return url;
  return url.includes("?") ? `${url}&sslmode=require` : `${url}?sslmode=require`;
}

loadEnvFile(".env.local");
loadEnvFile(".env.development.local");
loadEnvFile(".env");
loadEnvFile(".env.development");

const rawConnectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!rawConnectionString) {
  console.error("ERROR: No database URL found.");
  process.exit(1);
}

const client = new Client({
  connectionString: ensureSslMode(rawConnectionString),
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  const columns = await client.query(`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trend_signals'
    order by ordinal_position
  `);

  console.log("\n=== trend_signals columns ===\n");
  console.table(columns.rows);

  const sample = await client.query(`
    select *
    from trend_signals
    order by captured_ts desc
    limit 5
  `);

  console.log("\n=== trend_signals sample rows ===\n");
  console.table(sample.rows);
} finally {
  await client.end();
}
