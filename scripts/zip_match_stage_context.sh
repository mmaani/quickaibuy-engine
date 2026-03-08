#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
OUT="${2:-match-stage-context-files.zip}"

cd "$ROOT"

FILES=(
  "src/lib/jobNames.ts"
  "src/lib/jobs/jobNames.ts"
  "src/lib/jobs/types.ts"
  "src/lib/jobs/enqueueTrendExpand.ts"
  "src/workers/jobs.worker.ts"
  "src/lib/db/schema.ts"
  "src/lib/db/productsRaw.ts"
  "src/lib/db/marketplacePrices.ts"
  "src/lib/jobs/marketplaceScan.ts"
  "src/lib/marketplaces/ebay.ts"
  "src/lib/marketplaces/amazon.ts"
  "src/lib/marketplaces/match.ts"
  "src/lib/marketplaces/trendMarketplaceScanner.ts"
  "scripts/enqueue_marketplace_scan.ts"
  "scripts/check_marketplace_prices.mjs"
  "scripts/debug_marketplace_scan.ts"
  "scripts/run_marketplace_scan_direct.ts"
)

for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "Missing file: $f" >&2
    exit 1
  fi
done

rm -f "$OUT"
zip -r "$OUT" "${FILES[@]}"

echo "Created: $(pwd)/$OUT"
