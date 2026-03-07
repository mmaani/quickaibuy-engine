#!/usr/bin/env bash
set -euo pipefail

EBAY_CLIENT_ID="$(grep '^EBAY_CLIENT_ID=' .env.local | cut -d= -f2- | tr -d '\r')"
EBAY_CLIENT_SECRET="$(grep '^EBAY_CLIENT_SECRET=' .env.local | cut -d= -f2- | tr -d '\r')"

if [[ -z "${EBAY_CLIENT_ID:-}" || -z "${EBAY_CLIENT_SECRET:-}" ]]; then
  echo "Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in .env.local"
  exit 1
fi

B64="$(printf '%s:%s' "$EBAY_CLIENT_ID" "$EBAY_CLIENT_SECRET" | base64 | tr -d '\n')"

curl --http1.1 -sS -X POST 'https://api.ebay.com/identity/v1/oauth2/token' \
  -H "Authorization: Basic $B64" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
