#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <trendSignalId>"
  exit 1
fi

node --import tsx scripts/test_trend_expand.mjs "$1"
