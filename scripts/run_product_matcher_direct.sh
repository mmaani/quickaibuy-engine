#!/usr/bin/env bash
set -euo pipefail
source .env.local 2>/dev/null || true
pnpm exec tsx scripts/run_product_matcher_direct.ts
