#!/usr/bin/env bash
set -euo pipefail
set -a
source .env.local
set +a
env | grep '^EBAY_' || true
env | grep '^MARKETPLACE_' || true
