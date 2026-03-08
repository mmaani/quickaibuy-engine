#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
OUT="${2:-existing-matcher-context.zip}"

cd "$ROOT"

FILES=(
  "src/lib/matching/productMatcher.ts"
  "src/lib/profit/profitEngine.ts"
  "src/lib/db/index.ts"
  "src/lib/db/schema.ts"
  "src/lib/jobNames.ts"
  "src/lib/jobs/jobNames.ts"
  "src/workers/jobs.worker.ts"
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
