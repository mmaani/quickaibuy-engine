#!/usr/bin/env bash
set -euo pipefail

echo "===== src/lib/db.ts ====="
sed -n '1,120p' src/lib/db.ts

echo
echo "===== src/lib/db/index.ts ====="
sed -n '1,220p' src/lib/db/index.ts
