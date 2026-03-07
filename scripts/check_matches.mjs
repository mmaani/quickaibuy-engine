import fs from "fs";
import { Client } from "pg";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
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

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const client = new Client({
  connectionString: ensureSslMode(connectionString),
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  const count = await client.query(`select count(*)::int as n from matches`);
  console.log("\nTotal matches:", count.rows[0]?.n ?? 0);

  const sample = await client.query(`
    select
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      match_type,
      confidence,
      status,
      first_seen_ts,
      last_seen_ts
    from matches
    order by last_seen_ts desc
    limit 20
  `);

  console.table(sample.rows);
} finally {
  await client.end();
}
