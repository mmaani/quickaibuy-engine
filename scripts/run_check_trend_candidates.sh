#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] run_check_trend_candidates.sh is deprecated. Use node scripts/check_trend_candidates.mjs instead." >&2

node scripts/check_trend_candidates.mjs
