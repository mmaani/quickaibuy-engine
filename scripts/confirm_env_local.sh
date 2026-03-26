#!/usr/bin/env bash
set -euo pipefail

if [ ! -f ".env.local" ]; then
  echo ".env.local not found"
  exit 1
fi

set -a
source .env.local
set +a

check_var() {
  local name="$1"
  if [ -n "${!name:-}" ] && [ "${!name}" != "REPLACE_ME" ]; then
    echo "OK   $name"
  else
    echo "MISS $name"
  fi
}

echo "Checking required local env vars..."
check_var DATABASE_URL
check_var EBAY_CLIENT_ID
check_var EBAY_CLIENT_SECRET
check_var EBAY_MARKETPLACE_ID
check_var MARKETPLACE_MIN_MATCH_SCORE
check_var MARKETPLACE_QUERY_LIMIT
check_var MARKETPLACE_SCAN_DELAY_MS
check_var MARKETPLACE_ALLOW_TOP_RESULT_FALLBACK
check_var MATCH_MIN_CONFIDENCE
check_var PROFIT_MIN_MATCH_CONFIDENCE
check_var MIN_ROI_PCT
check_var MARKETPLACE_FEE_PCT
check_var OTHER_COST_USD

echo
echo "Checking threshold floor alignment..."
python3 - <<'PY'
import os

def parse(name):
    try:
        return float(os.environ.get(name, ""))
    except ValueError:
        return None

for key in ("MATCH_MIN_CONFIDENCE", "PROFIT_MIN_MATCH_CONFIDENCE"):
    value = parse(key)
    if value is None:
        print(f"WARN {key} is not numeric")
    elif value < 0.70:
        print(f"WARN {key}={value:.2f} is below policy floor 0.70")
    else:
        print(f"OK   {key}={value:.2f}")
PY

echo
echo "Checking .gitignore protection..."
if [ -f ".gitignore" ] && grep -qxF ".env.local" .gitignore; then
  echo "OK   .env.local is ignored by git"
else
  echo "WARN .env.local is not explicitly ignored in .gitignore"
fi
