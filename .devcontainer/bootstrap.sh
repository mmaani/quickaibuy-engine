#!/usr/bin/env bash
set -euo pipefail

echo "==> Setting PNPM_HOME"
export PNPM_HOME="/home/codespace/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

echo "==> Verifying bubblewrap"
if ! command -v bwrap >/dev/null 2>&1; then
  echo "==> bubblewrap missing; installing fallback package for existing Codespaces"
  sudo apt-get update
  sudo apt-get install -y bubblewrap
fi
bwrap --version

echo "==> Installing Codex"
npm install -g @openai/codex

echo "==> Installing project dependencies"
pnpm install --no-frozen-lockfile

echo "==> Initializing Git LFS"
git lfs install || true

echo "==> Bootstrap complete"
