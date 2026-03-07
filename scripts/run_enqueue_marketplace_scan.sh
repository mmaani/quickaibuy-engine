#!/usr/bin/env bash
set -euo pipefail
source .env.local 2>/dev/null || true
pnpm exec tsx scripts/enqueue_marketplace_scan.ts "${1:-100}" "${2:-all}" "${3:-}"
