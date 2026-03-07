#!/usr/bin/env bash
set -euo pipefail

node scripts/enqueue_trend_expand.ts "${1:-}"
