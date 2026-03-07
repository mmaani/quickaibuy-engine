#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-production}"
TMP_ENV_FILE=".env.vercel.${ENVIRONMENT}.tmp"
LOCAL_ENV_FILE=".env.local"
ROOT_ENV_FILE=".env"

echo "Pulling Vercel env (${ENVIRONMENT}) into ${TMP_ENV_FILE} ..."
npx vercel env pull "${TMP_ENV_FILE}" --environment "${ENVIRONMENT}"

cp "${TMP_ENV_FILE}" "${LOCAL_ENV_FILE}"
echo "Updated ${LOCAL_ENV_FILE} from Vercel."

echo "Building ${ROOT_ENV_FILE} from pulled env vars ..."
node - "${TMP_ENV_FILE}" "${ROOT_ENV_FILE}" <<'NODE'
const fs = require("fs");
const dotenv = require("dotenv");

const srcPath = process.argv[2];
const outPath = process.argv[3];
const parsed = dotenv.parse(fs.readFileSync(srcPath, "utf8"));

const required = ["DATABASE_URL", "DATABASE_URL_DIRECT"];
for (const key of required) {
  if (!parsed[key]) {
    console.error(`Missing required env var from Vercel: ${key}`);
    process.exit(1);
  }
}

function validateNeonUrl(name, value, expectedPooler) {
  let u;
  try {
    u = new URL(value);
  } catch {
    console.error(`${name} is not a valid URL.`);
    process.exit(1);
  }
  const isPooler = u.hostname.includes("-pooler.");
  const isNeon = u.hostname.includes("neon.tech");
  if (!isNeon) {
    console.error(`${name} does not look like a Neon host: ${u.hostname}`);
    process.exit(1);
  }
  if (isPooler !== expectedPooler) {
    const want = expectedPooler ? "pooled (-pooler host)" : "direct (non-pooler host)";
    console.error(`${name} host mismatch. Expected ${want}, got ${u.hostname}`);
    process.exit(1);
  }
}

validateNeonUrl("DATABASE_URL", parsed.DATABASE_URL, true);
validateNeonUrl("DATABASE_URL_DIRECT", parsed.DATABASE_URL_DIRECT, false);

const appUrl = parsed.APP_URL || parsed.NEXT_PUBLIC_APP_URL || "https://hub.quickaibuy.com";
const appEnv = parsed.APP_ENV || (process.env.NODE_ENV === "production" ? "production" : "development");

const ordered = [
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "APP_URL",
  "APP_ENV",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "REDIS_URL",
  "BULL_PREFIX",
  "JOBS_QUEUE_NAME",
  "ENGINE_QUEUE_NAME",
];

const merged = {
  DATABASE_URL: parsed.DATABASE_URL,
  DATABASE_URL_DIRECT: parsed.DATABASE_URL_DIRECT,
  APP_URL: appUrl,
  APP_ENV: appEnv,
  UPSTASH_REDIS_REST_URL: parsed.UPSTASH_REDIS_REST_URL || "",
  UPSTASH_REDIS_REST_TOKEN: parsed.UPSTASH_REDIS_REST_TOKEN || "",
  REDIS_URL: parsed.REDIS_URL || "",
  BULL_PREFIX: parsed.BULL_PREFIX || "",
  JOBS_QUEUE_NAME: parsed.JOBS_QUEUE_NAME || "",
  ENGINE_QUEUE_NAME: parsed.ENGINE_QUEUE_NAME || "",
};

const lines = ["# Auto-generated from Vercel env pull. Do not edit manually."];
for (const key of ordered) {
  const value = merged[key];
  if (!value) continue;
  lines.push(`${key}="${String(value).replace(/"/g, '\\"')}"`);
}
lines.push("");

fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outPath}`);
NODE

echo "Verifying live DB connections for pooled + direct URLs ..."
node - "${TMP_ENV_FILE}" <<'NODE'
const fs = require("fs");
const dotenv = require("dotenv");
const { Pool } = require("pg");

const srcPath = process.argv[2];
const parsed = dotenv.parse(fs.readFileSync(srcPath, "utf8"));

const checks = [
  ["DATABASE_URL", parsed.DATABASE_URL],
  ["DATABASE_URL_DIRECT", parsed.DATABASE_URL_DIRECT],
];

(async () => {
  for (const [name, url] of checks) {
    const u = new URL(url);
    const pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: true },
    });
    try {
      const res = await pool.query("select current_database() as db, current_user as usr");
      console.log(`${name}: OK host=${u.hostname} db=${res.rows[0].db} user=${res.rows[0].usr}`);
    } catch (err) {
      console.error(`${name}: FAILED host=${u.hostname} error=${err.message}`);
      process.exitCode = 1;
    } finally {
      await pool.end().catch(() => {});
    }
  }
})()
  .catch((err) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
  })
  .finally(() => {
    try {
      fs.unlinkSync(srcPath);
    } catch {}
  });
NODE

if [[ "${PIPESTATUS[0]}" -ne 0 ]]; then
  echo "Database verification failed."
  exit 1
fi

echo "Done."
echo "Next: pnpm build && pnpm lint"
