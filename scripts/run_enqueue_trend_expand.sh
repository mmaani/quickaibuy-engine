#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <trendSignalId>"
  exit 1
fi

node scripts/enqueue_trend_expand.ts "$1"
