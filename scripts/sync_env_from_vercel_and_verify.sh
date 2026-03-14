#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-production}"
TMP_ENV_FILE=".env.vercel.${ENVIRONMENT}.tmp"
VERCEL_ENV_FILE=".env.vercel"

echo "Pulling Vercel env (${ENVIRONMENT}) into ${TMP_ENV_FILE} ..."
npx vercel env pull "${TMP_ENV_FILE}" --environment "${ENVIRONMENT}"

cp "${TMP_ENV_FILE}" "${VERCEL_ENV_FILE}"
echo "Updated ${VERCEL_ENV_FILE} from Vercel."

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
echo "Production runtime env is stored in ${VERCEL_ENV_FILE}."
echo "Keep .env.local mapped to your development Neon branch."
