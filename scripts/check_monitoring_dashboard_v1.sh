#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_URL="${APP_URL:-http://localhost:3000/dashboard}"
WORKER_LOG="${WORKER_LOG:-/tmp/quickaibuy-worker.log}"
APP_LOG="${APP_LOG:-/tmp/quickaibuy-app.log}"

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

section() {
  printf '\n============================================================\n'
  printf '%s\n' "$1"
  printf '============================================================\n'
}

info() {
  printf '• %s\n' "$1"
}

warn() {
  printf '⚠ %s\n' "$1"
}

ok() {
  printf '✅ %s\n' "$1"
}

fail() {
  printf '❌ %s\n' "$1"
}

cleanup() {
  if [[ -n "${APP_PID:-}" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${WORKER_PID:-}" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

run_sql() {
  local q="$1"
  node --import dotenv/config scripts/db_inspect.mjs "$q"
}

wait_for_http() {
  local url="$1"
  local tries="${2:-30}"
  local sleep_s="${3:-2}"

  for ((i=1; i<=tries; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_s"
  done
  return 1
}

capture_http() {
  local url="$1"
  curl -fsS "$url"
}

section "0) Basic repo checks"

[[ -f package.json ]] || { fail "Run this from repo root"; exit 1; }
[[ -f src/app/dashboard/page.tsx ]] || warn "Dashboard page not found at src/app/dashboard/page.tsx"
[[ -f src/lib/dashboard/getDashboardData.ts ]] || warn "Dashboard data loader not found at src/lib/dashboard/getDashboardData.ts"

have_cmd node || { fail "node not installed"; exit 1; }
have_cmd pnpm || { fail "pnpm not installed"; exit 1; }
have_cmd curl || { fail "curl not installed"; exit 1; }

ok "Repo root and basic tools look available"

section "1) Lint / typecheck"

if grep -q '"lint"' package.json; then
  pnpm lint || warn "pnpm lint failed"
else
  warn "No lint script found"
fi

if grep -q '"typecheck"' package.json; then
  pnpm typecheck || warn "pnpm typecheck failed"
else
  warn "No typecheck script found"
fi

section "2) Database counts"

for table in trend_signals trend_candidates products_raw marketplace_prices matches profitable_candidates; do
  info "Count: $table"
  run_sql "select count(*) from ${table};" || warn "Could not query ${table}"
done

section "3) Recent rows"

info "Recent trend_signals"
run_sql "select * from trend_signals order by id desc limit 5;" || warn "Could not query trend_signals recent rows"

info "Recent matches"
run_sql "select * from matches order by id desc limit 5;" || warn "Could not query matches recent rows"

info "Recent profitable_candidates"
run_sql "select * from profitable_candidates order by id desc limit 5;" || warn "Could not query profitable_candidates recent rows"

section "4) Start worker"

if pgrep -f "jobs.worker" >/dev/null 2>&1; then
  warn "A jobs worker already seems to be running"
else
  nohup pnpm worker:jobs >"$WORKER_LOG" 2>&1 &
  WORKER_PID=$!
  sleep 4
  if kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    ok "Started worker: PID $WORKER_PID"
  else
    fail "Worker failed to start"
    [[ -f "$WORKER_LOG" ]] && tail -n 80 "$WORKER_LOG"
  fi
fi

section "5) Start app"

if curl -fsS "http://localhost:3000" >/dev/null 2>&1; then
  warn "Something is already serving localhost:3000"
else
  nohup pnpm dev >"$APP_LOG" 2>&1 &
  APP_PID=$!
  info "Waiting for app to be ready..."
  if wait_for_http "http://localhost:3000" 45 2; then
    ok "App is responding on localhost:3000"
  else
    fail "App did not start in time"
    [[ -f "$APP_LOG" ]] && tail -n 120 "$APP_LOG"
  fi
fi

section "6) Fetch dashboard HTML"

DASH_HTML="$(capture_http "$APP_URL" || true)"

if [[ -z "$DASH_HTML" ]]; then
  fail "Could not fetch $APP_URL"
else
  ok "Fetched $APP_URL"
fi

if grep -qi "Monitoring Dashboard" <<<"$DASH_HTML"; then
  ok "Dashboard page content detected"
else
  warn "Dashboard title text not detected in HTML"
fi

if grep -qi "Could not find BullMQ connection export" <<<"$DASH_HTML"; then
  fail "Old BullMQ connection error still appears on dashboard"
else
  ok "Old BullMQ connection error not found in dashboard output"
fi

section "7) Enqueue test jobs"

info "Marketplace scan enqueue"
if bash scripts/run_enqueue_marketplace_scan.sh; then
  ok "Marketplace scan enqueue succeeded"
else
  warn "Marketplace scan enqueue failed"
fi

info "Trend expand enqueue"
if bash scripts/run_enqueue_trend_expand.sh; then
  ok "Trend expand enqueue succeeded without manual ID"
else
  warn "Trend expand enqueue without ID failed; trying fallback with latest trend signal ID"
  LATEST_ID="$(node --import dotenv/config scripts/db_inspect.mjs "select id from trend_signals order by id desc limit 1;" 2>/dev/null | grep -Eo '[0-9]+' | head -n 1 || true)"
  if [[ -n "$LATEST_ID" ]]; then
    info "Using fallback trend signal ID: $LATEST_ID"
    if bash scripts/run_enqueue_trend_expand.sh "$LATEST_ID"; then
      ok "Trend expand enqueue succeeded with fallback ID"
    else
      warn "Trend expand enqueue failed even with fallback ID"
    fi
  else
    warn "No trend_signals row found for fallback enqueue"
  fi
fi

info "Product match enqueue"
if [[ -f scripts/run_enqueue_product_match.sh ]]; then
  if bash scripts/run_enqueue_product_match.sh; then
    ok "Product match enqueue succeeded"
  else
    warn "Product match enqueue failed"
  fi
else
  warn "scripts/run_enqueue_product_match.sh not found"
fi

section "8) Give worker time to process"

sleep 8

section "9) Re-check dashboard"

DASH_HTML_AFTER="$(capture_http "$APP_URL" || true)"

if [[ -z "$DASH_HTML_AFTER" ]]; then
  fail "Could not re-fetch dashboard after enqueue"
else
  ok "Dashboard re-fetched after enqueue"
fi

if grep -qi "Recent succeeded jobs" <<<"$DASH_HTML_AFTER"; then
  ok "Recent succeeded jobs section exists"
else
  warn "Recent succeeded jobs section text not found"
fi

if grep -qi "Recent failed jobs" <<<"$DASH_HTML_AFTER"; then
  ok "Recent failed jobs section exists"
else
  warn "Recent failed jobs section text not found"
fi

if grep -qi "Queue: jobs" <<<"$DASH_HTML_AFTER"; then
  ok "Queue name appears as jobs"
else
  warn "Queue name text not detected as jobs"
fi

if grep -qi "Could not find BullMQ connection export" <<<"$DASH_HTML_AFTER"; then
  fail "BullMQ connection error still present after enqueue"
else
  ok "BullMQ connection error still absent after enqueue"
fi

section "10) Post-enqueue counts"

for table in trend_signals trend_candidates products_raw marketplace_prices matches profitable_candidates; do
  info "Count after enqueue: $table"
  run_sql "select count(*) from ${table};" || warn "Could not query ${table}"
done

section "11) Logs tail"

if [[ -f "$WORKER_LOG" ]]; then
  info "Last worker log lines"
  tail -n 60 "$WORKER_LOG" || true
fi

if [[ -f "$APP_LOG" ]]; then
  info "Last app log lines"
  tail -n 60 "$APP_LOG" || true
fi

section "12) Final status"

cat <<EOM
Manual checks to confirm in browser:
1. Open: $APP_URL
2. Confirm Infrastructure health shows DB and Redis healthy
3. Confirm Job visibility shows queue counts
4. Confirm no red BullMQ connection export error
5. Confirm recent succeeded jobs and/or failed jobs look real
6. Confirm fresh activity tables populate
EOM
