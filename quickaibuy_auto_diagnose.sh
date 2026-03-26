#!/usr/bin/env bash
set -u

REPORT="quickaibuy_auto_diagnose_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee "$REPORT") 2>&1

echo "============================================================"
echo "QuickAIBuy Auto Diagnose"
echo "Started: $(date)"
echo "User: $(whoami)"
echo "PWD: $(pwd)"
echo "============================================================"
echo

section () {
  echo
  echo "------------------------------------------------------------"
  echo "$1"
  echo "------------------------------------------------------------"
}

run_cmd () {
  echo
  echo "+ $*"
  bash -lc "$*"
  local status=$?
  echo
  echo "[exit_code=$status]"
  return 0
}

safe_find_text () {
  local base="$1"
  local label="$2"
  section "$label"
  if [ -e "$base" ]; then
    run_cmd "find '$base' -type f 2>/dev/null | sed -n '1,300p'"
  else
    echo "Path not found: $base"
  fi
}

safe_grep () {
  local path_expr="$1"
  local label="$2"
  section "$label"
  run_cmd "grep -RniE 'github/issue_read|Gemini 3 Flash|Gemini|model:|tools:|mcp|copilot|agent' $path_expr 2>/dev/null | sed -n '1,300p'"
}

section "Environment Snapshot"
run_cmd "pwd"
run_cmd "ls -la"
run_cmd "git rev-parse --show-toplevel 2>/dev/null || true"
run_cmd "git branch --show-current 2>/dev/null || true"
run_cmd "node -v 2>/dev/null || true"
run_cmd "pnpm -v 2>/dev/null || true"

section "Repo Search: targeted config folders"
safe_grep ".github .vscode .cursor .windsurf ." "Search repo for bad tool/model/config patterns"

section "Repo Search: likely config/manifests"
run_cmd "find . -maxdepth 4 \\( -iname '*mcp*' -o -iname '*agent*' -o -iname '*copilot*' -o -iname '*prompt*' -o -iname '*manifest*' \\) 2>/dev/null | sed -n '1,300p'"

section "Home Directory Search: likely user-level config"
run_cmd "find ~ -maxdepth 5 \\( -iname '*mcp*' -o -iname '*agent*' -o -iname '*copilot*' -o -iname '*cursor*' -o -iname '*windsurf*' -o -iname '*prompt*' \\) 2>/dev/null | sed -n '1,400p'"

section "Home Directory Search: grep likely config"
safe_grep "~/.vscode* ~/.config ~/" "Search user-level config for bad tool/model/config patterns"

section "VS Code / Copilot likely locations"
safe_find_text "$HOME/.vscode" "List ~/.vscode"
safe_find_text "$HOME/.vscode-server" "List ~/.vscode-server"
safe_find_text "$HOME/.config" "List ~/.config"

section "QuickAIBuy Health Checks"
if [ -f ".env.vercel" ]; then
  echo ".env.vercel found."
  run_cmd "DOTENV_CONFIG_PATH=.env.vercel node --import dotenv/config --import tsx scripts/check_worker_run_truth.ts"
  run_cmd "DOTENV_CONFIG_PATH=.env.vercel node --import dotenv/config --import tsx scripts/check_upstream_schedules.ts"
  run_cmd "DOTENV_CONFIG_PATH=.env.vercel node --import dotenv/config --import tsx scripts/check_revenue_enablement_truth.ts"
else
  echo "WARNING: .env.vercel not found in current directory, skipping health checks."
fi

section "Quick Summary Heuristics"
echo "If grep output above shows github/issue_read or Gemini 3 Flash, that is the config you need to remove/update."
echo "If worker truth shows stale timestamps, production still needs deploy + worker restart."
echo "If schedules exist but worker timestamps are stale, the scheduler config is present but execution is unhealthy."

section "Finished"
echo "Report saved to: $REPORT"
echo "Completed: $(date)"
