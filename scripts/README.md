# QuickAIBuy Scripts Governance (v1)

This index defines the canonical script model for operational safety.

## Prefix contract

- `check_*` → read-only diagnostics (prod-safe: usually **yes**)
- `enqueue_*` → queue mutation (prod-safe: **guarded**)
- `run_*` → runtime/worker execution wrappers (prod-safe: **guarded**)
- `mutate_*` → explicit DB/repo state mutation (prod-safe: **no**, guarded)
- `debug_*` / `inspect_*` → ad hoc diagnostics (prod-safe: **operator discretion**)

## Mandatory preflight for high-risk scripts

High-risk mutate/migrate scripts require:

- `ALLOW_MUTATION_SCRIPTS=true`
- if production (`APP_ENV=production` or `VERCEL_ENV=production`), also `ALLOW_PROD_MUTATIONS=true`

Shared shell guard helper: `scripts/lib/preflightMutation.sh`.

## Canonical command map

| Intent | Canonical command | Risk | Prod-safe | Owner thread |
|---|---|---:|---|---|
| Execute one SQL migration file | `node scripts/mutate_execute_sql_file.mjs migrations/<file>.sql` | HIGH | No (guarded) | Platform Setup / Infrastructure |
| Run trend-candidates migration | `bash scripts/run_trend_candidates_migration.sh` | HIGH | No (guarded) | Platform Setup / Infrastructure |
| Run matches migration | `bash scripts/run_matches_migration.sh` | HIGH | No (guarded) | Platform Setup / Infrastructure |
| Run controlled listing gate migration | `bash scripts/run_controlled_listing_gate_migration.sh` | HIGH | No (guarded) | Platform Setup / Infrastructure |
| Mark stale `PUBLISH_IN_PROGRESS` listings as failed | `pnpm exec tsx scripts/mutate_listings_mark_stale_publish_failed.ts` | HIGH | No (guarded) | Platform Setup / Infrastructure |
| Enqueue inventory risk scan | `pnpm exec tsx scripts/enqueue_inventory_risk_scan.ts` | HIGH | Guarded | Platform Setup / Infrastructure |
| Enqueue listing prepare | `pnpm exec tsx scripts/enqueue_listing_prepare.ts` | HIGH | Guarded | Platform Setup / Infrastructure |
| Enqueue listing optimize | `pnpm enqueue:listing-optimize` | HIGH | Guarded | Railway Deployment for jobs.worker |
| Queue namespace diagnostics | `pnpm exec tsx scripts/queue_namespace_diagnostics.ts` | MED | Yes | Platform Setup / Infrastructure |
| Inventory-risk schedule check | `pnpm exec tsx scripts/check_inventory_risk_schedule.ts` | MED | Yes | Platform Setup / Infrastructure |
| Worker runtime dependency preflight | `pnpm preflight:worker-runtime` | MED | Yes | Railway Deployment for jobs.worker |
| Runtime dashboard checks | `bash scripts/check_monitoring_dashboard_v1.sh` | MED | Yes | Platform Setup / Infrastructure |

## Renamed high-risk scripts

These ambiguous scripts were renamed to explicit-risk names:

- `scripts/push_pipeline_to_main.sh` → `scripts/mutate_git_push_pipeline_to_main.sh`
- `scripts/run_sql_file.mjs` → `scripts/mutate_execute_sql_file.mjs`
- `scripts/cleanup_stale_publish_in_progress.ts` → `scripts/mutate_listings_mark_stale_publish_failed.ts`

## Dangerous scripts (do not run casually)

- `scripts/mutate_git_push_pipeline_to_main.sh`
  - stages all files, commits, and pushes to `main`
  - requires `ALLOW_MUTATION_SCRIPTS=true` and `CONFIRM_PUSH_MAIN=YES`
- `scripts/mutate_execute_sql_file.mjs`
  - runs arbitrary SQL against configured DB
- `scripts/run_*migration*.sh`
  - executes schema/data migrations

## Deprecation policy

- New scripts must use a governance prefix above.
- Do not add `_v2`, `_v3`, `_latest` variants without explicit deprecation plan and canonical replacement entry in this README.
- Prefer one canonical script per operational intent.


## Phase 2 canonicalization (duplicate wrappers and versioned variants)

The following scripts are kept for one transition phase as **deprecated warning wrappers** to avoid breaking existing operational flows.

| Canonical command | Deprecated command | Replacement path |
|---|---|---|
| `node scripts/check_audit_log.mjs` | `bash scripts/run_check_audit_log.sh` | Run canonical command directly. |
| `node scripts/check_marketplace_price_urls.mjs` | `bash scripts/run_check_marketplace_price_urls.sh` | Run canonical command directly. |
| `node --import dotenv/config scripts/check_marketplace_prices.mjs` | `bash scripts/run_check_marketplace_prices.sh` | Run canonical command directly. |
| `node scripts/check_match_duplicates.mjs` | `bash scripts/run_check_match_duplicates.sh` | Run canonical command directly. |
| `node scripts/check_matches.mjs` | `bash scripts/run_check_matches.sh`, `node scripts/check_matches_latest.mjs` | Use `check_matches.mjs` for canonical match diagnostics. |
| `node scripts/check_profit_duplicates.mjs` | `bash scripts/run_check_profit_duplicates.sh` | Run canonical command directly. |
| `node scripts/check_profitable_candidates.mjs` | `bash scripts/run_check_profitable_candidates.sh`, `node scripts/workers/check_profitable_candidates_latest.mjs` | Use top-level profitable candidate diagnostic. |
| `node scripts/check_trend_candidates.mjs` | `bash scripts/run_check_trend_candidates.sh` | Run canonical command directly. |
| `node scripts/check_trend_candidates_for_signal.mjs <trendSignalId>` | `bash scripts/run_check_trend_candidates_for_signal.sh <trendSignalId>` | Run canonical command directly. |
| `node scripts/check_trend_signals.mjs` | `bash scripts/run_check_trend_signals.sh` | Run canonical command directly. |
| `bash scripts/run_controlled_listing_gate_migration.sh` | `bash scripts/run_controlled_listing_gate_migration_v2.sh`, `bash scripts/run_controlled_listing_gate_migration_v3.sh` | Use canonical migration wrapper; `v2` wrapper temporarily runs legacy normalization + canonical migration. |
| `pnpm exec tsx scripts/run_marketplace_scan_monitoring.ts` | `pnpm exec tsx scripts/run_marketplace_scan_monitoring_latest.ts` | Use non-versioned monitoring command. |
| `node scripts/check_listing_previews_ready_source.mjs` | `node scripts/workers/check_listing_previews_latest.mjs` | Use listing preview readiness source diagnostic. |
