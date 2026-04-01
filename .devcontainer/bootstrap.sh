#!/usr/bin/env bash
set -euo pipefail

echo "==> Setting PNPM_HOME"
export PNPM_HOME="/home/codespace/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

echo "==> Installing Codex"
npm install -g @openai/codex

echo "==> Installing project dependencies"
pnpm install --no-frozen-lockfile

echo "==> Initializing Git LFS"
git lfs install || true

echo "==> Bootstrap complete"
