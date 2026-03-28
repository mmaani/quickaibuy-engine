#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/preflightMutation.sh
require_mutation_preflight "mutate_git_push_pipeline_to_main.sh"

if [[ "${CONFIRM_PUSH_MAIN:-}" != "YES" ]]; then
  echo "blocked: set CONFIRM_PUSH_MAIN=YES to acknowledge direct push-to-main risk" >&2
  exit 1
fi

COMMIT_MSG="${1:-feat: harden ebay-only marketplace pipeline v1}"

echo "Current branch:"
git branch --show-current

echo
echo "Checking whether .env.local is tracked..."
if git ls-files --error-unmatch .env.local >/dev/null 2>&1; then
  echo "ERROR: .env.local is tracked by git."
  echo "Run:"
  echo "  git rm --cached .env.local"
  echo "  echo '.env.local' >> .gitignore"
  exit 1
else
  echo "OK: .env.local is not tracked"
fi

echo
git status --short

echo
git add .

echo
git status --short

echo
git commit -m "$COMMIT_MSG" || echo "No new commit created."

echo
git push origin HEAD:main

echo "Done."
