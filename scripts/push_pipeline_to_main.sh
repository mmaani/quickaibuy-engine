#!/usr/bin/env bash
set -euo pipefail

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
