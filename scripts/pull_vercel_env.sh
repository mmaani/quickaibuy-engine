#!/usr/bin/env bash
set -euo pipefail

# Requires: npm i -g vercel (or use npx)
ENVIRONMENT="${1:-production}"
TARGET_FILE="${2:-.env.vercel}"

if [[ "${TARGET_FILE}" == ".env.local" && "${ENVIRONMENT}" == "production" ]]; then
  echo "Refusing to pull Vercel production env into .env.local."
  echo "Use .env.vercel for production runtime env, or pass a non-production environment explicitly."
  exit 1
fi

npx vercel env pull "${TARGET_FILE}" --environment "${ENVIRONMENT}"

echo "Pulled Vercel ${ENVIRONMENT} env into ${TARGET_FILE}"
echo "Load with: set -a; source ${TARGET_FILE}; set +a"
