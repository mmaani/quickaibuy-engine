#!/usr/bin/env bash
set -euo pipefail
source .env.local 2>/dev/null || true
node scripts/check_match_duplicates.mjs
