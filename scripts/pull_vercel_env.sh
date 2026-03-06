#!/usr/bin/env bash
set -euo pipefail

# Requires: npm i -g vercel (or use npx)
# Pull env vars into .env.local
npx vercel env pull .env.local

echo "Pulled env vars into .env.local"
echo "Now load them with: set -a; source .env.local; set +a"
