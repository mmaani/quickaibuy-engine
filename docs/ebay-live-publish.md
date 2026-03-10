# eBay Live Publish Prerequisites (QuickAIBuy v1)

QuickAIBuy v1 supports live publish for eBay only. Amazon live publish remains deferred and must stay non-blocking.

## Location Model

- Seller base location is represented by the eBay seller account and `EBAY_MERCHANT_LOCATION_KEY`.
- Supplier ship-from country is separate from seller base location.
- `shipFromCountry` must come from supplier data (`supplier_warehouse_country` preferred, `ship_from_country` fallback) and is normalized to ISO alpha-2.
- Live publish blocks when normalized supplier ship-from country is unknown.

Do not use seller base country as a fallback for item ship-from country.

## Required Env Vars

- `WEBSITE_URL` (for example `https://quickaibuy.com`)
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_REFRESH_TOKEN`
- `EBAY_MARKETPLACE_ID` (for example `EBAY_US`)
- `EBAY_MERCHANT_LOCATION_KEY`
- `EBAY_PAYMENT_POLICY_ID`
- `EBAY_RETURN_POLICY_ID`
- `EBAY_FULFILLMENT_POLICY_ID`
- `EBAY_DEFAULT_CATEGORY_ID`
- `ENABLE_EBAY_LIVE_PUBLISH`

## Required Public URLs For eBay User-Token Flow

These URLs are generated from `WEBSITE_URL`:

- Privacy Policy URL: `${WEBSITE_URL}/privacy`
- OAuth accepted URL: `${WEBSITE_URL}/ebay/auth/accepted`
- OAuth declined URL: `${WEBSITE_URL}/ebay/auth/declined`

For production, QuickAIBuy uses:

- `https://quickaibuy.com/privacy`
- `https://quickaibuy.com/ebay/auth/accepted`
- `https://quickaibuy.com/ebay/auth/declined`

## Token Model

- Live publish uses runtime refresh-token exchange (`EBAY_REFRESH_TOKEN`) to mint short-lived access tokens.
- Access tokens are not persisted to repository files.
- Token errors are surfaced with explicit operator actions (`invalid_client`, `invalid_scope`, `invalid_grant`, malformed token response).

## Business Policy and Inventory Location Dependencies

- `merchantLocationKey` (seller-base inventory location) must exist in the seller account inventory locations.
- Payment, return, and fulfillment policy IDs must be configured.
- Default eBay category ID is required and used when no category is provided in payload.

## Diagnostics

- `pnpm exec tsx scripts/check_ebay_publish_env.ts`
  - validates required env/config values
  - redacts secret values
  - prints resolved public URLs
- `pnpm exec tsx scripts/check_ebay_inventory_location.ts`
  - fetches inventory locations
  - verifies configured `EBAY_MERCHANT_LOCATION_KEY` exists
  - exits non-zero if missing
