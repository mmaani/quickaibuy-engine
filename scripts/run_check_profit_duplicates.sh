#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] run_check_profit_duplicates.sh is deprecated. Use node scripts/check_profit_duplicates.mjs instead." >&2

source .env.local 2>/dev/null || true
node scripts/check_profit_duplicates.mjs
