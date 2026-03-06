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

const trendSignalId = process.argv[2];

if (!rawConnectionString) {
  console.error("ERROR: No database URL found.");
  process.exit(1);
}

if (!trendSignalId) {
  console.error("Usage: node scripts/check_trend_candidates_for_signal.mjs <trendSignalId>");
  process.exit(1);
}

const client = new Client({
  connectionString: ensureSslMode(rawConnectionString),
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  const result = await client.query(
    `
      SELECT
        id,
        trend_signal_id,
        candidate_type,
        candidate_value,
        region,
        status,
        created_ts,
        meta
      FROM trend_candidates
      WHERE trend_signal_id = $1
      ORDER BY candidate_value ASC
    `,
    [trendSignalId]
  );

  console.table(result.rows);
} finally {
  await client.end();
}
