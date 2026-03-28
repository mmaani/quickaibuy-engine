#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/preflightMutation.sh
require_mutation_preflight "fix_env_local_missing.sh"

touch .env.local

append_if_missing() {
  local key="$1"
  local value="$2"
  if ! grep -qE "^${key}=" .env.local; then
    printf '%s=%s\n' "$key" "$value" >> .env.local
    echo "Added $key"
  else
    echo "Exists $key"
  fi
}

append_if_missing "EBAY_MARKETPLACE_ID" "EBAY_US"
append_if_missing "MARKETPLACE_MIN_MATCH_SCORE" "0.15"
append_if_missing "MARKETPLACE_QUERY_LIMIT" "5"
append_if_missing "MARKETPLACE_SCAN_DELAY_MS" "100"
append_if_missing "MARKETPLACE_ALLOW_TOP_RESULT_FALLBACK" "true"

echo "Done."
