# Railway Jobs Worker Runbook

This runbook defines the production-safe Railway deployment shape for the persistent `jobs.worker` service.

## Service shape

- Host: Railway
- Service type: private worker service
- Public domain: not required
- Build method: Railway native Railpack with config-as-code in `railway.json`
- Start command:

```bash
pnpm preflight:worker-runtime && pnpm worker:jobs:prod
```

Why this shape:

- No Dockerfile is needed for the current repo.
- No HTTP server is needed for `jobs.worker`.
- `railway.json` pins the worker start command and restart policy in code.
- Railway should keep a single long-running worker deployment alive and restart it if the process exits.
- The preflight keeps the worker fail-closed if Redis, Postgres, or queue namespace env is missing.

## Required environment variables

These should be set on the Railway worker service.

### Required for the worker runtime itself

- `APP_ENV=production`
- `NODE_ENV=production`
- `BULL_PREFIX=qaib-prod`
- `JOBS_QUEUE_NAME=jobs-prod`
- `REDIS_URL`
- `DATABASE_URL`

### Required for autonomous freshness and supplier / marketplace pipeline execution

- `PRICE_GUARD_MAX_MARKETPLACE_SNAPSHOT_AGE_HOURS`
- `PRICE_GUARD_MAX_SUPPLIER_SNAPSHOT_AGE_HOURS`
- `PRICE_GUARD_MIN_PROFIT_USD`
- `PRICE_GUARD_MIN_MARGIN_PCT`
- `PRICE_GUARD_MIN_ROI_PCT`
- `PRICE_GUARD_REVIEW_PROFIT_BUFFER_USD`
- `PRICE_GUARD_REVIEW_MARGIN_BUFFER_PCT`
- `PRICE_GUARD_REVIEW_ROI_BUFFER_PCT`
- `PRICE_GUARD_MAX_SUPPLIER_DRIFT_PCT`
- `PRICE_GUARD_REQUIRE_SHIPPING_DATA`
- `PRICE_GUARD_REQUIRE_SUPPLIER_DRIFT_DATA`
- `PROFIT_EBAY_FEE_RATE_PCT`
- `PROFIT_PAYOUT_RESERVE_PCT`
- `PROFIT_PAYMENT_RESERVE_PCT`
- `PROFIT_FX_RESERVE_PCT`
- `PROFIT_SHIPPING_VARIANCE_PCT`
- `PROFIT_FIXED_COST_USD`
- `MIN_ROI_PCT`
- `PROFIT_MIN_MARGIN_PCT`
- `PROFIT_MIN_MATCH_CONFIDENCE`
- `MATCH_MIN_CONFIDENCE`
- `MATCH_MIN_MARKETPLACE_SCORE`
- `MATCH_MIN_OVERLAP`
- `MARKETPLACE_MIN_PRICE_RATIO`
- `MARKETPLACE_MAX_PRICE_RATIO`
- `MARKETPLACE_QUERY_TIMEOUT_MS`
- `MARKETPLACE_QUERY_RETRIES`
- `MARKETPLACE_QUERY_BACKOFF_MS`
- `MARKETPLACE_MIN_MATCH_SCORE`
- `MARKETPLACE_QUERY_LIMIT`
- `MARKETPLACE_SCAN_DELAY_MS`
- `MARKETPLACE_ALLOW_TOP_RESULT_FALLBACK`
- `SUPPLIER_DISCOVER_CANDIDATE_LIMIT`
- `CJ_API_KEY`
- `CJ_DISCOVER_COUNTRY_CODE`
- `CJ_DISCOVER_MIN_INVENTORY`
- `SUPPLIER_FETCH_PROXY_URL` or scraping provider keys used in production
- `SUPPLIER_FETCH_PROXY_TOKEN` if proxy is used
- `ZENROWS_API_KEY` if used in production
- `SCRAPINGBEE_API_KEY` if used in production

### Required for `LISTING_OPTIMIZE`

These should match the production app env exactly so listing optimization can read traffic, recommendations, and revise active listings safely.

- `WEBSITE_URL`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_REFRESH_TOKEN` or `EBAY_USER_REFRESH_TOKEN`
- `EBAY_MARKETPLACE_ID`
- `EBAY_MERCHANT_LOCATION_KEY` or `EBAY_LOCATION_KEY`
- `EBAY_PAYMENT_POLICY_ID` or `EBAY_POLICY_PAYMENT_ID`
- `EBAY_RETURN_POLICY_ID` or `EBAY_POLICY_RETURN_ID`
- `EBAY_FULFILLMENT_POLICY_ID` or `EBAY_POLICY_FULFILLMENT_ID` or `EBAY_SHIPPING_POLICY_ID`
- `EBAY_DEFAULT_CATEGORY_ID` or `EBAY_CATEGORY_ID`
- `EBAY_IMAGE_PROVIDER_DEFAULT`
- `EBAY_IMAGE_HOSTING_PROVIDER`
- `EBAY_IMAGE_PROVIDER_ALLOW_TRADING_FALLBACK`
- `EBAY_API_ROOT` if production overrides the default
- `EBAY_TRADING_COMPATIBILITY_LEVEL` if production overrides the default
- `EBAY_TRADING_SITE_ID` if production overrides the default
- `LISTING_PERF_WINDOW_DAYS`
- `LISTING_PERF_MAX_ATTEMPTS`
- `LISTING_PERF_APPLY_LIVE_EDITS`
- `LISTING_LOW_TRAFFIC_VIEWS_THRESHOLD`
- `LISTING_PROMOTED_MAX_BID_PCT`
- `LISTING_PROMOTED_MAX_DELTA_PCT`

### Safety variables to keep explicit

- `ENABLE_EBAY_LIVE_PUBLISH=false`
- `ENABLE_EBAY_TRACKING_SYNC` should match current production policy

## Variables that should match Vercel production exactly

For this worker, the safest setup is to copy the Vercel production env into Railway, then keep only worker-relevant variables enabled. At minimum, these must match exactly:

- `DATABASE_URL`
- `REDIS_URL`
- `BULL_PREFIX`
- `JOBS_QUEUE_NAME`
- all `EBAY_*` values used by `LISTING_OPTIMIZE`
- `WEBSITE_URL`
- all profit / matching / price guard thresholds used in production
- all supplier provider credentials used in production

## Variables that should not be set manually for this worker

- `DOTENV_CONFIG_PATH`
- `NEXT_PHASE`
- `VERCEL`
- `VERCEL_ENV`
- `VERCEL_URL`
- `NEXT_PUBLIC_*` variables not needed by the worker runtime

Railway may inject its own platform variables such as `PORT`; those can remain untouched.

## Deployment steps

1. In Railway, create a new service in the existing project using this GitHub repo.
2. Keep the service private. Do not generate a public domain.
3. Railway will read `railway.json` and use:
   - build command: `null`
   - start command: `pnpm preflight:worker-runtime && pnpm worker:jobs:prod`
   - restart policy: `ALWAYS`
4. Paste the required environment variables into the service Variables tab.
5. Confirm `APP_ENV=production`, `BULL_PREFIX=qaib-prod`, and `JOBS_QUEUE_NAME=jobs-prod`.
6. Deploy the service.
7. After the worker is healthy, run one manual `LISTING_OPTIMIZE` enqueue to verify first live execution.

## One-shot `LISTING_OPTIMIZE` trigger

Use this from any trusted environment with the production Redis + DB env loaded:

```bash
pnpm enqueue:listing-optimize
```

Optional custom limit / trigger label:

```bash
node --import dotenv/config --import tsx scripts/enqueue_listing_optimize.ts 10 railway-first-run
```

## Verification commands

Run these after the Railway worker is live:

```bash
pnpm lint
pnpm build
pnpm exec tsc --noEmit
DOTENV_CONFIG_PATH=.env.vercel node --import dotenv/config --import tsx scripts/check_worker_run_truth.ts
DOTENV_CONFIG_PATH=.env.vercel node --import dotenv/config --import tsx scripts/check_upstream_schedules.ts
DOTENV_CONFIG_PATH=.env.vercel node --import dotenv/config --import tsx scripts/check_revenue_enablement_truth.ts
```

Success criteria:

- `workerAlive = true`
- no missing upstream stages
- `LISTING_OPTIMIZE` shows a `worker_runs` success row
- `listingPerformanceRowsPresent = true`
- `/admin/control` shows worker, pipeline, and revenue state with live commercial metrics

## Relevant official Railway docs

- Variables: https://docs.railway.com/develop/variables
- Deployments reference: https://docs.railway.com/deployments/reference
- Deployment actions: https://docs.railway.com/deployments/deployment-actions
- Networking: https://docs.railway.com/develop/networking
