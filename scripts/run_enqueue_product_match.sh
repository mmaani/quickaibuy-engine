#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx scripts/enqueue_product_match.ts "${1:-250}" "${2:-1000}" "${3:-0.75}"
