#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] run_check_marketplace_prices.sh is deprecated. Use node --import dotenv/config scripts/check_marketplace_prices.mjs instead." >&2

source .env.local 2>/dev/null || true
node --import dotenv/config scripts/check_marketplace_prices.mjs
