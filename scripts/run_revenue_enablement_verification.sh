#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DOTENV_FILE="${DOTENV_CONFIG_PATH:-.env.vercel}"

echo "== Revenue Enablement Verification =="
echo "repo: $ROOT_DIR"
echo "dotenv: $DOTENV_FILE"
echo

echo "== Local validation =="
pnpm lint
pnpm build
pnpm exec tsc --noEmit
echo

echo "== Production worker truth =="
DOTENV_CONFIG_PATH="$DOTENV_FILE" node --import dotenv/config --import tsx scripts/check_worker_run_truth.ts
echo

echo "== Production repeatable schedules =="
DOTENV_CONFIG_PATH="$DOTENV_FILE" node --import dotenv/config --import tsx scripts/check_upstream_schedules.ts
echo

echo "== Production revenue/listing truth =="
DOTENV_CONFIG_PATH="$DOTENV_FILE" node --import dotenv/config --import tsx scripts/check_revenue_enablement_truth.ts
echo

echo "== Notes =="
echo "1. This script verifies code and runtime truth. It does not deploy code."
echo "2. It does not restart the production jobs worker."
echo "3. If worker timestamps are stale, deploy current code and restart the production jobs worker, then rerun this script."
