#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <trendSignalId>"
  exit 1
fi

echo "[DEPRECATED] run_check_trend_candidates_for_signal.sh is deprecated. Use node scripts/check_trend_candidates_for_signal.mjs <trendSignalId> instead." >&2

node scripts/check_trend_candidates_for_signal.mjs "$1"
