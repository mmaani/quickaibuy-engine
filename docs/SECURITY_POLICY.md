# QuickAIBuy Security Policy

## Secrets

Secrets must never be committed to this repository.

Allowed locations:

- hosting environment variables
- ignored local env files such as `.env.local`, `.env.vercel`, or equivalent ignored env files

Disallowed locations:

- committed source files
- committed docs
- client-side code and browser bundles
- generated source packages or runtime artifacts

Never print secret values in terminal output, docs, screenshots, or logs.

## Repo-Observed Secret And Config Patterns

Based on repo inspection, the real server-side secret and config patterns in use include:

- database connection strings: `DATABASE_URL`, `DATABASE_URL_DIRECT`
- Redis connection string: `REDIS_URL`
- eBay auth and publish config: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`, `EBAY_MARKETPLACE_ID`, `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_DEFAULT_CATEGORY_ID`
- review console auth: `REVIEW_CONSOLE_USERNAME`, `REVIEW_CONSOLE_PASSWORD`
- runtime environment and queue isolation config: `APP_ENV`, `BULL_PREFIX`, `JOBS_QUEUE_NAME`, `ENGINE_QUEUE_NAME`
- publishing and operations flags: `ENABLE_EBAY_LIVE_PUBLISH`, `ENABLE_EBAY_TRACKING_SYNC`, listing caps, price guard thresholds, profit thresholds, marketplace scan thresholds

Only placeholder values belong in `.env.example` files.

## Client Bundle Boundary

Server-only secrets must never enter client bundles. This repo currently appears to expose only `NEXT_PUBLIC_*` values intentionally for public runtime metadata. Server-only values such as DB URLs, Redis URLs, review credentials, and eBay secrets must remain in server modules, API routes, workers, and scripts only.

## Runtime Abuse And Unsafe Endpoint Notes

Inspection found these operational considerations:

- `src/app/api/health/review-debug/route.ts` is a Basic Auth protected debug endpoint that returns environment metadata and DB fingerprints. It does not print raw secrets, but it increases operational exposure and should remain tightly restricted or removed when no longer needed.
- Basic Auth is used for review/admin access in `src/lib/review/auth.ts`. Credentials must come from env only and must never be hardcoded.
- Guarded publish logic depends on `ENABLE_EBAY_LIVE_PUBLISH`; keep it disabled by default outside explicit guarded publish actions.
- Queue namespace isolation is safety-critical. Shared Redis deployments must keep environment-specific prefixes and queue names separate.

## Required Practices

- Prefer redacted diagnostics over raw config dumps.
- Keep runtime-generated artifacts, bundles, and local env files ignored.
- Treat scripts that mutate production-like data as high risk and keep explicit guard flags in place.
