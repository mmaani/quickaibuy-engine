#!/usr/bin/env bash
set -euo pipefail
source .env.local 2>/dev/null || true
node scripts/check_marketplace_price_urls.mjs
