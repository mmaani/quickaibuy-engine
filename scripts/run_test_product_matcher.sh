#!/usr/bin/env bash
set -euo pipefail

pnpm exec tsx scripts/test_product_matcher.mjs "${1:-100}" "${2:-500}" "${3:-0.75}"
