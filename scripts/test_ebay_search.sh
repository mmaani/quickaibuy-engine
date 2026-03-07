#!/usr/bin/env bash
set -euo pipefail

QUERY="${1:-wireless earbuds}"
MARKETPLACE_ID="${EBAY_MARKETPLACE_ID:-EBAY_US}"

EBAY_CLIENT_ID="$(grep '^EBAY_CLIENT_ID=' .env.local | cut -d= -f2- | tr -d '\r')"
EBAY_CLIENT_SECRET="$(grep '^EBAY_CLIENT_SECRET=' .env.local | cut -d= -f2- | tr -d '\r')"

if [[ -z "${EBAY_CLIENT_ID:-}" || -z "${EBAY_CLIENT_SECRET:-}" ]]; then
  echo "Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in .env.local"
  exit 1
fi

B64="$(printf '%s:%s' "$EBAY_CLIENT_ID" "$EBAY_CLIENT_SECRET" | base64 | tr -d '\n')"

TOKEN="$(
  curl --http1.1 -sS 'https://api.ebay.com/identity/v1/oauth2/token' \
    -X POST \
    -H "Authorization: Basic $B64" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope' \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.access_token||"")}catch(e){process.stderr.write(d);process.exit(1)}})'
)"

if [[ -z "$TOKEN" ]]; then
  echo "Failed to get eBay OAuth token"
  exit 1
fi

ENC_QUERY="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$QUERY")"

curl --http1.1 -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-EBAY-C-MARKETPLACE-ID: $MARKETPLACE_ID" \
  "https://api.ebay.com/buy/browse/v1/item_summary/search?q=${ENC_QUERY}&limit=5" \
| python3 -m json.tool
