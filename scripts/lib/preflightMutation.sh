#!/usr/bin/env bash
set -euo pipefail

# Shared guardrails for high-risk mutate/migrate scripts.
# Usage:
#   source scripts/lib/preflightMutation.sh
#   require_mutation_preflight "script-name"
# Optional env:
#   ALLOW_MUTATION_SCRIPTS=true
#   ALLOW_PROD_DB_MUTATION=true
#   CONFIRM_PROD_DB_TARGET=YES

require_mutation_preflight() {
  local context="${1:-mutation-script}"
  node --import tsx scripts/guard_mutation.mjs "$context"
}
