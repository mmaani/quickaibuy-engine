#!/usr/bin/env bash
set -u

REPORT="quickaibuy_diag_clean_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee "$REPORT") 2>&1

echo "=== QuickAIBuy Clean Diagnose ==="
echo "Started: $(date)"
echo "PWD: $(pwd)"
echo

run() {
  echo
  echo "+ $*"
  bash -lc "$*"
  echo "[exit_code=$?]"
}

echo "== Targeted repo config search =="
run "find . \\( -path './node_modules' -o -path './.next' -o -path './.git' \\) -prune -o -type f \\( -iname '*agent*' -o -iname '*mcp*' -o -iname '*copilot*' -o -iname '*prompt*' -o -name '*.md' -o -name '*.json' -o -name '*.yaml' -o -name '*.yml' \\) -print | sed -n '1,300p'"

run "find . \\( -path './node_modules' -o -path './.next' -o -path './.git' \\) -prune -o -type f -print0 | xargs -0 grep -nH -E 'github/issue_read|Gemini 3 Flash|Gemini|model:|tools:|mcp|copilot|agent' 2>/dev/null | sed -n '1,300p'"

echo
echo "== Common top-level files =="
run "ls -la .github .vscode .cursor .windsurf 2>/dev/null || true"
run "find . -maxdepth 3 -type f \\( -name 'AGENTS.md' -o -name 'mcp.json' -o -name 'devcontainer.json' -o -name 'copilot-instructions.md' \\) 2>/dev/null | sed -n '1,200p'"

echo
echo "== Health checks =="
if [ -f ".env.vercel" ]; then
  run "DOTENV_CONFIG_PATH=.env.vercel node --import dotenv/config --import tsx scripts/check_worker_run_truth.ts"
  run "DOTENV_CONFIG_PATH=.env.vercel node --import dotenv/config --import tsx scripts/check_upstream_schedules.ts"
  run "DOTENV_CONFIG_PATH=.env.vercel node --import dotenv/config --import tsx scripts/check_revenue_enablement_truth.ts"
else
  echo ".env.vercel not found"
fi

echo
echo "Report: $REPORT"
