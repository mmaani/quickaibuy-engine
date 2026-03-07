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

  const result = await client.query(`
    select
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      match_type,
      confidence,
      evidence
    from matches
    order by confidence desc, last_seen_ts desc
    limit 30
  `);

  result.rows.forEach((row, i) => {
    console.log(`\n===== MATCH ${i + 1} =====`);
    console.log("supplier:", row.supplier_key, row.supplier_product_id);
    console.log("marketplace:", row.marketplace_key, row.marketplace_listing_id);
    console.log("type:", row.match_type, "confidence:", row.confidence);
    console.dir(row.evidence, { depth: null });
  });
} finally {
  await client.end();
}
