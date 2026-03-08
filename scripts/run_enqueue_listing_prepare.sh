#!/usr/bin/env bash
set -euo pipefail
source .env.local 2>/dev/null || true
pnpm exec tsx scripts/enqueue_listing_prepare.ts "${1:-20}" "${2:-ebay}" "${3:-false}"
