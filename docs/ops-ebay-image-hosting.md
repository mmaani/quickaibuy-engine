# eBay Image Hosting Ops Note

## Current v1 path

QuickAIBuy normalizes the final ranked eBay listing image set into eBay Picture Services (EPS) URLs before a listing may reach `READY_TO_PUBLISH`.

The provider abstraction currently supports:
- `media_api_url`
- `trading_upload_site_hosted_pictures`
- `mock_eps` for local proofing and dry-run validation

## Deprecation note

eBay documents `UploadSiteHostedPictures` as deprecated and scheduled for decommission on September 30, 2026. eBay recommends the Media API `createImageFromFile` / `createImageFromUrl` methods for the forward path.

QuickAIBuy therefore keeps the EPS upload logic isolated behind `src/lib/marketplaces/ebayImageHosting.ts` so the readiness pipeline can migrate providers without changing:
- image ranking
- preview generation
- `READY_TO_PUBLISH` gating
- final publish validation

## Current provider policy

- Default provider: Media API
- Temporary fallback: Trading `UploadSiteHostedPictures`
- Fallback is explicitly recorded in normalization diagnostics
- Target state before 2026-09-30: remove Trading fallback entirely

## Operator expectation

If EPS normalization fails:
- the preview may still exist for inspection
- the listing must remain non-publishable
- the listing response and audit trail should carry the `IMAGE_NORMALIZATION_*` code and blocking reason
