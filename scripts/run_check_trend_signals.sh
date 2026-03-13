#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] run_check_trend_signals.sh is deprecated. Use node scripts/check_trend_signals.mjs instead." >&2

node scripts/check_trend_signals.mjs
