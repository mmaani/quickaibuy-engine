#!/usr/bin/env bash
set -euo pipefail

# Shared guardrails for high-risk mutate/migrate scripts.
# Usage:
#   source scripts/lib/preflightMutation.sh
#   require_mutation_preflight "script-name"
# Optional env:
#   ALLOW_MUTATION_SCRIPTS=true   (required)
#   ALLOW_PROD_MUTATIONS=true     (required only for production APP_ENV/VERCEL_ENV)

require_mutation_preflight() {
  local context="${1:-mutation-script}"

  if [[ "${ALLOW_MUTATION_SCRIPTS:-false}" != "true" ]]; then
    echo "[${context}] blocked: set ALLOW_MUTATION_SCRIPTS=true to run high-risk mutation/migration scripts." >&2
    exit 1
  fi

  local app_env="${APP_ENV:-${VERCEL_ENV:-development}}"
  app_env="$(printf '%s' "$app_env" | tr '[:upper:]' '[:lower:]')"

  if [[ "$app_env" == "production" || "$app_env" == "prod" ]]; then
    if [[ "${ALLOW_PROD_MUTATIONS:-false}" != "true" ]]; then
      echo "[${context}] blocked in production: set ALLOW_PROD_MUTATIONS=true to acknowledge production mutation risk." >&2
      exit 1
    fi
  fi

  echo "[${context}] preflight ok (APP_ENV=${app_env})."
}
