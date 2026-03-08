#!/usr/bin/env bash
set -euo pipefail
source .env.local 2>/dev/null || true
pnpm exec tsx scripts/run_listing_prepare_direct.ts "${1:-20}" "${2:-ebay}" "${3:-false}"
