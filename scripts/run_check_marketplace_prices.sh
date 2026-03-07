#!/usr/bin/env bash
set -euo pipefail
source .env.local 2>/dev/null || true
node --import dotenv/config scripts/check_marketplace_prices.mjs
