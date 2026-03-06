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

    if (!(key in process.env)) {
      process.env[key] = val;
    }
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

const sqlFile = process.argv[2];

if (!rawConnectionString) {
  console.error("ERROR: No database URL found in env files.");
  process.exit(1);
}

if (!sqlFile || !fs.existsSync(sqlFile)) {
  console.error("ERROR: SQL file missing.");
  console.error("Usage: node scripts/run_sql_file.mjs path/to/file.sql");
  process.exit(1);
}

const connectionString = ensureSslMode(rawConnectionString);
const sql = fs.readFileSync(sqlFile, "utf8");

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);
  console.log(`OK: executed ${sqlFile}`);
} catch (err) {
  console.error("ERROR executing SQL:");
  console.error(err);
  process.exit(1);
} finally {
  await client.end();
}
