# Operational Surface

Summary: QuickAIBuy now has one explicit operator-facing command model. `pnpm ops:full-cycle` is the canonical daily operating path, `/admin/control` is the aligned control-plane surface, and direct legacy scripts are either engineering-only or retired.

## Canonical command model

| Intent | Canonical command or surface | Classification |
|---|---|---|
| Daily operation | `pnpm ops:full-cycle` | Canonical operational command |
| Scoped backbone run | `pnpm ops:autonomous diagnostics_refresh|prepare|publish` | Canonical operational command |
| Learning refresh | `pnpm ops:learning-refresh` | Canonical operational command |
| Supplier wave / discovery rebuild | `pnpm ops:supplier-wave` | Canonical operational command |
| Runtime diagnostics | `pnpm runtime:diag` | Canonical diagnostic command |
| Live integrity diagnostics | `pnpm check:live-integrity` | Canonical diagnostic command |
| Runtime probe | `pnpm probe:runtime` | Canonical diagnostic command |
| Worker start | `pnpm worker:jobs` | Canonical operational command |
| Engine boot-path verification | `pnpm worker:engine:dev` / `pnpm worker:engine:prod` | Canonical diagnostic command |
| Inventory risk scan enqueue | `pnpm enqueue:inventory-risk-scan` | Canonical controlled mutation |
| Supplier discovery enqueue | `pnpm enqueue:supplier-discover` | Canonical controlled mutation |
| Profit eval enqueue | `pnpm enqueue:profit-eval` | Canonical controlled mutation |
| Listing optimize enqueue | `pnpm enqueue:listing-optimize` | Canonical controlled mutation |
| SQL mutation wrapper | `node scripts/mutate_execute_sql_file.mjs ...` | Canonical mutation/repair |
| Controlled listing gate migration | `bash scripts/run_controlled_listing_gate_migration.sh` | Canonical mutation/repair |
| Stale publish fail-close repair | `pnpm exec tsx scripts/mutate_listings_mark_stale_publish_failed.ts` | Canonical mutation/repair |
| Control-plane operator surface | `/admin/control` | Canonical operational surface |

## Operator-facing package command inventory

### Canonical operational commands

- `ops:full-cycle`
- `ops:autonomous`
- `ops:learning-refresh`
- `ops:supplier-wave`
- `worker:jobs`

### Canonical diagnostics

- `env:dev`
- `env:prod`
- `env:status`
- `db:status`
- `db:assert-dev`
- `db:assert-prod`
- `probe:runtime`
- `runtime:diag`
- `check:live-integrity`
- `preflight:runtime-deps`
- `preflight:runtime-deps:dev`
- `preflight:runtime-deps:prod`
- `preflight:worker-runtime`
- `diag:db-fingerprint`
- `diag:env-compare`
- `diag:vercel-env-access`
- `diag:queue-namespace`
- `check:migration-ledger`
- `check:inventory-risk-schedule`
- `check:upstream-schedules`
- `check:worker-run-truth`
- `check:schema-drift`
- `check:mutation-safety`
- `check:payment-storage`

### Canonical controlled mutation / enqueue

- `enqueue:supplier-discover`
- `enqueue:inventory-risk-scan`
- `enqueue:profit-eval`
- `enqueue:listing-optimize`
- `worker:railway-env:build`
- `worker:railway-env:validate`

### Engineering-only package commands

- `worker:engine:dev`
- `worker:engine:prod`
- `verify:profit-pipeline`
- `check:tracking-test-order`
- `repo-tree:update`
- `repo-tree:watch`

### Test/dev-only package commands

- `dev`
- `build`
- `start`
- `lint`
- `test`
- `test:listings`
- `trend:expand:test`
- `product:discover:test`
- `query:allocate:test`
- `db:generate`
- `db:migrate`
- `db:push`

## Script family inventory

### Canonical runtime/library-backed entrypoints

- `scripts/run_full_cycle.ts`
- `scripts/run_autonomous_operations.ts`
- `scripts/run_learning_refresh.ts`
- `scripts/run_supplier_wave_regeneration.ts`
- `scripts/runtime_diagnostics.ts`
- `scripts/check_live_state_integrity.ts`
- `scripts/preflight_runtime_dependencies.ts`
- `scripts/check_worker_runtime_dependencies.ts`

### Canonical diagnostics retained in `scripts/`

- `scripts/probe_runtime.ts`
- `scripts/check_runtime_db_fingerprint.mjs`
- `scripts/check_inventory_risk_schedule.ts`
- `scripts/check_upstream_schedules.ts`
- `scripts/check_worker_run_truth.ts`
- `scripts/queue_namespace_diagnostics.ts`
- `scripts/check_schema_drift.ts`
- `scripts/check_migration_ledger.ts`
- `scripts/check_vercel_env_access.ts`

### Retained low-level engineering utilities

- Direct queue helpers:
  `scripts/enqueue_listing_prepare.ts`,
  `scripts/enqueue_supplier_discover.ts`,
  `scripts/enqueue_inventory_risk_scan.ts`,
  `scripts/enqueue_profit_eval.ts`,
  `scripts/enqueue_listing_optimize.ts`
- Direct runtime workers:
  `scripts/run_listing_execution_direct.ts`,
  `scripts/run_listing_prepare_direct.ts`,
  `scripts/run_marketplace_scan_direct.ts`,
  `scripts/run_product_matcher_direct.ts`,
  `scripts/run_profit_engine_direct.ts`
- One-off repair/mutation utilities:
  `scripts/run_shipping_orphan_resolution.ts`,
  `scripts/approve_profitable_candidate.ts`,
  `scripts/reject_profitable_candidate.ts`,
  `scripts/promote_single_listing_ready.ts`,
  `scripts/run_single_listing_publish.ts`,
  `scripts/run_first_guarded_live_publish.ts`

### Deprecated legacy paths still present

- `scripts/enqueue_listing_prepare.ts`
  Superseded by `pnpm ops:autonomous prepare`.
- `scripts/run_listing_prepare_direct.ts`
- `scripts/run_listing_prepare_direct.sh`
- `scripts/run_listing_monitor_direct.ts`

These remain only because they are still potentially useful for engineering investigation. They are not canonical operating commands.

## Retired files

The following duplicate or versioned paths were retired after canonical replacements became explicit:

- `scripts/run_marketplace_scan_monitoring_latest.ts`
- `scripts/check_matches_latest.mjs`
- `scripts/workers/check_listing_previews_latest.mjs`
- `scripts/workers/check_profitable_candidates_latest.mjs`
- `scripts/run_check_audit_log.sh`
- `scripts/run_check_marketplace_price_urls.sh`
- `scripts/run_check_marketplace_prices.sh`
- `scripts/run_check_match_duplicates.sh`
- `scripts/run_check_matches.sh`
- `scripts/run_check_profit_duplicates.sh`
- `scripts/run_check_profitable_candidates.sh`
- `scripts/run_check_trend_candidates.sh`
- `scripts/run_check_trend_candidates_for_signal.sh`
- `scripts/run_check_trend_signals.sh`
- `scripts/run_controlled_listing_gate_migration_v2.sh`
- `scripts/run_controlled_listing_gate_migration_v3.sh`
- `scripts/enqueue_listing_prepare_approved.ts`
- `scripts/promote_listing_previews_ready.ts`
- `scripts/publish_one_ready_listing.ts`

## Runtime and secret surface

| Surface | Classification | Notes |
|---|---|---|
| `.env.dev` | Canonical source snapshot | Dev/local source env |
| `.env.prod` | Canonical source snapshot | Prod-aligned source env |
| `.env` | Canonical generated runtime | Active runtime file |
| `.env.active.json` | Canonical generated metadata | Active target metadata |
| `.env.local` | Compatibility file | Mirror for tools that auto-load it |
| `railway_worker.env` | Generated export file | Worker handoff artifact, not normal local runtime |
| `.env.vercel` | Sensitive compatibility/export file | Not canonical runtime source |
| `codex*.private` | Sensitive export surface | Not canonical runtime source |

## Control-plane alignment

- `/admin/control` quick actions invoke shared runtime functions in `src/lib/control/runControlQuickAction.ts`.
- Canonical full cycle maps to `runCanonicalFullCycle()` in `src/lib/autonomousOps/fullCycle.ts`.
- Canonical backbone phases map to `runAutonomousOperations()` in `src/lib/autonomousOps/backbone.ts`.
- Learning refresh maps to `runContinuousLearningRefresh()` in `src/lib/learningHub/continuousLearning.ts`.
- Inventory risk quick action uses the same `enqueueInventoryRiskScan()` helper as CLI enqueue paths.

There should be no operator-facing legacy script path required to trigger normal production behavior.
