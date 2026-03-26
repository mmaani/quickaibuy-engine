#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DOTENV_FILE="${DOTENV_CONFIG_PATH:-.env.vercel}"

echo "== QuickAIBuy Production-Linked Jobs Worker =="
echo "repo: $ROOT_DIR"
echo "dotenv: $DOTENV_FILE"
echo
echo "Starting src/workers/jobs.worker.ts against the production-linked environment."
echo "Use Ctrl+C to stop."
echo

exec env DOTENV_CONFIG_PATH="$DOTENV_FILE" node --import dotenv/config --import tsx src/workers/jobs.worker.ts
