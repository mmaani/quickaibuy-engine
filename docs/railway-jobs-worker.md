# Railway Jobs Worker Runbook

This runbook defines the production-safe Railway deployment shape for the persistent `jobs.worker` service.

## Service shape

- Host: Railway
- Service type: private worker service only
- Public domain: none
- Build method: Railway native Railpack with config-as-code in `railway.json`
- Start command:

```bash
pnpm preflight:worker-runtime && pnpm worker:jobs
```

`jobs.worker` is a long-running BullMQ consumer, not an HTTP app. The Railway service should stay private and should not expose a domain.

## Runtime paths covered by this env scope

The current `jobs.worker` runtime reaches these env-consuming paths:

- Startup and queue bootstrap:
  - `src/workers/jobs.worker.ts`
  - `src/lib/bull.ts`
  - `src/lib/db/index.ts`
  - `src/lib/queueNamespace.ts`
  - `src/lib/jobs/enqueueInventoryRiskScan.ts`
  - `src/lib/jobs/enqueueUpstreamSchedules.ts`
- Production job handlers that can execute under `jobs.worker`:
  - `src/lib/jobs/supplierDiscover.ts`
  - `src/lib/jobs/marketplaceScan.ts`
  - `src/lib/jobs/matchProducts.ts`
  - `src/lib/profit/profitEngine.ts`
  - `src/lib/listings/performanceEngine.ts`
  - `src/workers/orderSync.worker.ts`
  - `src/workers/inventoryRisk.worker.ts`
- Supplier and marketplace integrations reached by those handlers:
  - `src/lib/marketplaces/ebay.ts`
  - `src/lib/marketplaces/ebayPublish.ts`
  - `src/lib/marketplaces/ebayImageHosting.ts`
  - `src/lib/marketplaces/trendMarketplaceScanner.ts`
  - `src/lib/matches/ebayMatchEngine.ts`
  - `src/lib/matching/productMatcher.ts`
  - `src/lib/products/suppliers/cjdropshipping.ts`
  - `src/lib/products/suppliers/fetchWithFallback.ts`

## Variable buckets

### Required for Railway jobs worker startup

- `APP_ENV=production`
- `NODE_ENV=production`
- `REDIS_URL`
- `DATABASE_URL` or `DATABASE_URL_DIRECT`
- `BULL_PREFIX=qaib-prod`
- `JOBS_QUEUE_NAME=jobs-prod`

These are fail-closed. `src/lib/jobNames.ts` calls the queue namespace guard during module load, so a wrong production namespace blocks worker boot before job processing starts.

### Required for scheduled production job execution

These are required because the worker always schedules `LISTING_OPTIMIZE`, and that path validates the full eBay publish config before it can revise active listings:

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

### Optional overrides

These are read by worker-executed code but have defaults or are source-specific coverage knobs:

- Marketplace scan and matching:
  - `MARKETPLACE_MIN_PRICE_RATIO`
  - `MARKETPLACE_MAX_PRICE_RATIO`
  - `MARKETPLACE_QUERY_TIMEOUT_MS`
  - `MARKETPLACE_QUERY_RETRIES`
  - `MARKETPLACE_QUERY_BACKOFF_MS`
  - `MARKETPLACE_MIN_MATCH_SCORE`
  - `MARKETPLACE_QUERY_LIMIT`
  - `MARKETPLACE_SCAN_DELAY_MS`
  - `MARKETPLACE_ALLOW_TOP_RESULT_FALLBACK`
  - `MATCH_MIN_CONFIDENCE`
  - `MATCH_MIN_MARKETPLACE_SCORE`
  - `MATCH_MIN_OVERLAP`
  - `PROFIT_MIN_MATCH_CONFIDENCE`
- Profit and freshness:
  - `MIN_ROI_PCT`
  - `PROFIT_MIN_MARGIN_PCT`
  - `PROFIT_EBAY_FEE_RATE_PCT`
  - `PROFIT_PAYOUT_RESERVE_PCT`
  - `PROFIT_PAYMENT_RESERVE_PCT`
  - `PROFIT_FX_RESERVE_PCT`
  - `PROFIT_SHIPPING_VARIANCE_PCT`
  - `PROFIT_FIXED_COST_USD`
  - `PRICE_GUARD_MAX_MARKETPLACE_SNAPSHOT_AGE_HOURS`
  - `PRICE_GUARD_MAX_MARKET_SNAPSHOT_AGE_HOURS`
  - `PRICE_GUARD_MIN_PROFIT_USD`
  - `PRICE_GUARD_MIN_MARGIN_PCT`
  - `PRICE_GUARD_MIN_ROI_PCT`
  - `PRICE_GUARD_REVIEW_PROFIT_BUFFER_USD`
  - `PRICE_GUARD_REVIEW_MARGIN_BUFFER_PCT`
  - `PRICE_GUARD_REVIEW_ROI_BUFFER_PCT`
  - `PRICE_GUARD_MAX_SUPPLIER_DRIFT_PCT`
  - `PRICE_GUARD_MAX_SUPPLIER_SNAPSHOT_AGE_HOURS`
  - `PRICE_GUARD_REQUIRE_SHIPPING_DATA`
  - `PRICE_GUARD_REQUIRE_SUPPLIER_DRIFT_DATA`
- Supplier source coverage and fallback providers:
  - `SUPPLIER_DISCOVER_CANDIDATE_LIMIT`
  - `CJ_API_KEY`
  - `CJ_DISCOVER_COUNTRY_CODE`
  - `CJ_DISCOVER_MIN_INVENTORY`
  - `SUPPLIER_FETCH_PROXY_URL`
  - `SUPPLIER_FETCH_PROXY_TOKEN`
  - `ZENROWS_API_KEY`
  - `SCRAPINGBEE_API_KEY`

- Listing performance and image-hosting tuning:
  - `LISTING_PERF_WINDOW_DAYS`
  - `LISTING_PERF_MAX_ATTEMPTS`
  - `LISTING_PERF_APPLY_LIVE_EDITS`
  - `LISTING_LOW_TRAFFIC_VIEWS_THRESHOLD`
  - `LISTING_PROMOTED_MAX_BID_PCT`
  - `LISTING_PROMOTED_MAX_DELTA_PCT`
  - `EBAY_SELLER_FEEDBACK_SCORE`
  - `MEDIA_STORAGE_MODE`
  - `EBAY_IMAGE_PROVIDER_DEFAULT`
  - `EBAY_IMAGE_HOSTING_PROVIDER`
  - `EBAY_IMAGE_PROVIDER_ALLOW_TRADING_FALLBACK`
  - `EBAY_API_ROOT`
  - `EBAY_TRADING_COMPATIBILITY_LEVEL`
  - `EBAY_TRADING_SITE_ID`
- Worker batch tuning and safety pins:
  - `INVENTORY_RISK_SCAN_LIMIT`
  - `ORDER_SYNC_FETCH_LIMIT`
  - `ORDER_SYNC_LOOKBACK_HOURS`
  - `ORDER_SYNC_DEBUG`
  - `ENABLE_EBAY_TRACKING_SYNC`
  - `ENABLE_EBAY_LIVE_PUBLISH=false`

### CJ-specific runtime note

- `src/lib/products/suppliers/cjdropshipping.ts` now prefers `logistic/freightCalculateTip` during direct-product refresh and only falls back to `logistic/freightCalculate` when the richer quote cannot be produced.
- Railway worker coverage for CJ is materially better when the CJ account is verified. Public CJ docs state unverified users are capped at `1,000 calls/day per interface` and the lowest tier is limited to `1 request/second`.
- Treat the CJ API key as sensitive. Do not copy it into runbooks, logs, or tickets.

### Must not be manually set in Railway worker

- `APP_URL`
- `NEXT_PUBLIC_APP_URL`
- `NX_DAEMON`
- `TURBO_CACHE`
- `TURBO_DOWNLOAD_LOCAL_ENABLED`
- `TURBO_REMOTE_ONLY`
- `TURBO_RUN_SUMMARY`
- `VERCEL`
- `VERCEL_GIT_COMMIT_AUTHOR_LOGIN`
- `VERCEL_GIT_COMMIT_AUTHOR_NAME`
- `VERCEL_GIT_COMMIT_MESSAGE`
- `VERCEL_GIT_COMMIT_REF`
- `VERCEL_GIT_COMMIT_SHA`
- `VERCEL_GIT_PREVIOUS_SHA`
- `VERCEL_GIT_PROVIDER`
- `VERCEL_GIT_PULL_REQUEST_ID`
- `VERCEL_GIT_REPO_ID`
- `VERCEL_GIT_REPO_OWNER`
- `VERCEL_GIT_REPO_SLUG`
- `VERCEL_OIDC_TOKEN`
- `VERCEL_TARGET_ENV`
- `VERCEL_URL`

Also exclude frontend/public/build-only keys such as `NEXT_PUBLIC_*`, `VERCEL_*`, `TURBO_*`, and `NX_*`.

### Safe aliases and backwards-compatible alternatives

- `DATABASE_URL_DIRECT` may stand in for `DATABASE_URL`
- `EBAY_USER_REFRESH_TOKEN` may stand in for `EBAY_REFRESH_TOKEN`
- `EBAY_LOCATION_KEY` may stand in for `EBAY_MERCHANT_LOCATION_KEY`
- `EBAY_POLICY_PAYMENT_ID` may stand in for `EBAY_PAYMENT_POLICY_ID`
- `EBAY_POLICY_RETURN_ID` may stand in for `EBAY_RETURN_POLICY_ID`
- `EBAY_POLICY_FULFILLMENT_ID` or `EBAY_SHIPPING_POLICY_ID` may stand in for `EBAY_FULFILLMENT_POLICY_ID`
- `EBAY_CATEGORY_ID` may stand in for `EBAY_DEFAULT_CATEGORY_ID`
- `PRICE_GUARD_MAX_MARKET_SNAPSHOT_AGE_HOURS` is accepted as the legacy alias for `PRICE_GUARD_MAX_MARKETPLACE_SNAPSHOT_AGE_HOURS`

## Repo-tracked worker env workflow

Tracked files and scripts:

- Template file: `railway_worker.env.example`
- Build helper: `pnpm worker:railway-env:build`
- Validator: `pnpm worker:railway-env:validate`

Example local workflow in Codespaces:

```bash
pnpm worker:railway-env:build -- --from .env.prod,.env.vercel --out railway_worker.env
pnpm worker:railway-env:validate railway_worker.env
```

The builder reads local env files, keeps only approved worker-scoped keys, and writes a clean candidate file without transforming secret values. The validator checks:

- missing required worker vars
- forbidden platform/frontend/build vars
- suspicious public/build-only vars
- production queue namespace mismatches
- unsafe `ENABLE_EBAY_LIVE_PUBLISH=true`

It also warns when supplier-provider credentials are absent, because worker startup still succeeds but supplier discovery coverage may be reduced.

## Railway manual steps

1. Create a new Railway service from this repo in the existing project.
2. Keep the service private.
3. Do not attach a public domain.
4. Confirm Railway is using `railway.json`.
5. Generate the candidate env file locally:

```bash
pnpm worker:railway-env:build -- --from .env.prod,.env.vercel --out railway_worker.env
pnpm worker:railway-env:validate railway_worker.env
```

6. Open Railway service `Variables`.
7. Use the `RAW Editor`.
8. Paste only the cleaned contents of `railway_worker.env`.
9. Confirm these exact production safety values before deploy:
   - `APP_ENV=production`
   - `NODE_ENV=production`
   - `BULL_PREFIX=qaib-prod`
   - `JOBS_QUEUE_NAME=jobs-prod`
   - `ENABLE_EBAY_LIVE_PUBLISH=false`
10. Deploy from `main`.
11. Watch deploy logs for the preflight and worker boot lines:
   - successful Redis and database host checks
   - `APP_ENV=production`
   - `BULL_PREFIX=qaib-prod`
   - `JOBS_QUEUE_NAME=jobs-prod`
   - `[jobs.worker] booted and waiting for jobs`
12. After first healthy boot, enqueue `LISTING_OPTIMIZE` once from a trusted production-configured shell:

```bash
pnpm enqueue:listing-optimize
```

Optional labeled test:

```bash
node --import dotenv/config --import tsx scripts/enqueue_listing_optimize.ts 1 railway-first-run
```

## Post-deploy verification

Run the standard validation chain plus worker env checks:

```bash
pnpm lint
pnpm build
pnpm exec tsc --noEmit
pnpm worker:railway-env:validate railway_worker.env
DOTENV_CONFIG_PATH=.env.prod node --import dotenv/config --import tsx scripts/check_worker_run_truth.ts
DOTENV_CONFIG_PATH=.env.prod node --import dotenv/config --import tsx scripts/check_upstream_schedules.ts
DOTENV_CONFIG_PATH=.env.prod node --import dotenv/config --import tsx scripts/check_revenue_enablement_truth.ts
```

Success criteria:

- worker boot preflight passes
- `workerAlive = true`
- no missing upstream stages
- `LISTING_OPTIMIZE` produces a `worker_runs` success row
- listing performance metrics are present

## Variables intentionally excluded from the worker template

These were found in local env files but are not consumed by the `jobs.worker` runtime path, so they stay out of the Railway worker template:

- `APP_URL`
- `NEXT_PUBLIC_APP_URL`
- `REVIEW_CONSOLE_TOKEN`
- `REVIEW_CONSOLE_USERNAME`
- `REVIEW_CONSOLE_PASSWORD`
- `MARKETPLACE_FEE_PCT`
- `OTHER_COST_USD`
- `UPSTASH_REDIS_REST_TOKEN`
- `UPSTASH_REDIS_REST_URL`
- Vercel/Turbo/NX metadata

## Relevant Railway docs

- Variables: https://docs.railway.com/develop/variables
- Deployments reference: https://docs.railway.com/deployments/reference
- Deployment actions: https://docs.railway.com/deployments/deployment-actions
- Networking: https://docs.railway.com/develop/networking
