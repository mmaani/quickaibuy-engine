#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] run_check_marketplace_price_urls.sh is deprecated. Use node scripts/check_marketplace_price_urls.mjs instead." >&2

source .env.local 2>/dev/null || true
node scripts/check_marketplace_price_urls.mjs
