#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <trendSignalId>"
  exit 1
fi

node scripts/check_trend_candidates_for_signal.mjs "$1"
