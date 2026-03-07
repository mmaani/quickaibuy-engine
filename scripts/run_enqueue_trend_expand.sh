#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${1:-}" ]]; then
  echo "[run_enqueue_trend_expand] No trendSignalId supplied, selecting latest trend_signals row."
fi

node --import tsx scripts/enqueue_trend_expand.ts "${1:-}"
