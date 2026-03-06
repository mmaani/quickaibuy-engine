#!/usr/bin/env bash
set -euo pipefail

for cmd in psql node npm npx vercel; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "FOUND: $cmd -> $(command -v "$cmd")"
  else
    echo "MISSING: $cmd"
  fi
done
