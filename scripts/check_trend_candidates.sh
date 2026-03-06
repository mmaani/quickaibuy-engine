#!/usr/bin/env bash
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is not installed."
  echo "Run: ./scripts/install_psql.sh"
  exit 127
fi

load_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    echo "Loading env from $file"
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
    return 0
  fi
  return 1
}

load_env_file .env.local || \
load_env_file .env.development.local || \
load_env_file .env || \
load_env_file .env.development || true

DB_URL="${DATABASE_URL:-${POSTGRES_URL:-${POSTGRES_PRISMA_URL:-}}}"

if [[ -z "$DB_URL" ]]; then
  echo "ERROR: No database URL found."
  echo "Checked vars: DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL"
  echo "Checked files: .env.local, .env.development.local, .env, .env.development"
  exit 1
fi

psql "$DB_URL" -c "\d+ trend_candidates"
