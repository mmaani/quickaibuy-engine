#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] run_check_profitable_candidates.sh is deprecated. Use node scripts/check_profitable_candidates.mjs instead." >&2

source .env.local 2>/dev/null || true
node scripts/check_profitable_candidates.mjs
