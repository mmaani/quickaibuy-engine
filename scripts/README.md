# QuickAIBuy Operational Script Surface

This folder is no longer the operator-facing command surface by default. Human operators should start from `package.json` commands and `/admin/control`, then drop into `scripts/` only for diagnostics or explicitly documented engineering repair work.

## Canonical operator commands

| Intent | Canonical command | Notes |
|---|---|---|
| Daily operation | `pnpm ops:full-cycle` | Primary production operating command. |
| Backbone phase run | `pnpm ops:autonomous [full\|diagnostics_refresh\|prepare\|publish]` | Lower-level canonical phase runner. |
| Learning refresh | `pnpm ops:learning-refresh` | Canonical Learning Hub refresh. |
| Supplier wave refresh | `pnpm ops:supplier-wave` | Canonical supplier discovery plus rebuild wave. |
| Runtime diagnostics | `pnpm runtime:diag` | Canonical env/runtime classification. |
| Live integrity diagnostics | `pnpm check:live-integrity` | Canonical listing/integrity scan. |
| Worker start | `pnpm worker:jobs` | Canonical BullMQ consumer. |
| Engine boot-path check | `pnpm worker:engine:dev` / `pnpm worker:engine:prod` | For runtime boot-path verification, not daily operation. |

## Production-safe command boundary

- Operators should not run `scripts/run_*_direct*`, `scripts/publish_*`, `scripts/promote_*`, or ad hoc `enqueue_*` entrypoints manually unless the command is explicitly documented as canonical above.
- `pnpm ops:full-cycle` is the default human command.
- `/admin/control` quick actions are aligned to the same shared runtime/library functions that back canonical CLI commands.

## Classification model

### Canonical operational commands

- `scripts/run_full_cycle.ts`
- `scripts/run_autonomous_operations.ts`
- `scripts/run_learning_refresh.ts`
- `scripts/run_supplier_wave_regeneration.ts`
- `scripts/runtime_diagnostics.ts`
- `scripts/check_live_state_integrity.ts`
- `src/workers/jobs.worker.ts`
- `scripts/run_worker_engine_with_preflight.ts`

### Canonical diagnostics

- `scripts/probe_runtime.ts`
- `scripts/check_inventory_risk_schedule.ts`
- `scripts/check_upstream_schedules.ts`
- `scripts/check_worker_run_truth.ts`
- `scripts/check_runtime_db_fingerprint.mjs`
- `scripts/queue_namespace_diagnostics.ts`
- `scripts/check_schema_drift.ts`
- `scripts/check_migration_ledger.ts`
- `scripts/verify_blocked_candidate_recovery.ts` (read-only candidate recovery verifier; accepts candidate IDs and defaults to known blocked IDs)

### Canonical mutation and repair

- `scripts/mutate_execute_sql_file.mjs`
- `scripts/run_controlled_listing_gate_migration.sh`
- `scripts/mutate_listings_mark_stale_publish_failed.ts`

### Retained low-level engineering utilities

- `scripts/run_shipping_orphan_resolution.ts`
- `scripts/enqueue_listing_prepare.ts`
- `scripts/enqueue_supplier_discover.ts`
- `scripts/enqueue_inventory_risk_scan.ts`
- `scripts/enqueue_profit_eval.ts`
- `scripts/enqueue_listing_optimize.ts`
- `scripts/approve_profitable_candidate.ts`
- `scripts/reject_profitable_candidate.ts`
- `scripts/promote_single_listing_ready.ts`
- `scripts/run_single_listing_publish.ts`
- `scripts/run_first_guarded_live_publish.ts`
- `scripts/run_listing_execution_direct.ts`
- `scripts/run_marketplace_scan_direct.ts`
- `scripts/run_product_matcher_direct.ts`
- `scripts/run_profit_engine_direct.ts`

These remain for engineering or incident-response work only. They are not daily-operation commands.

### Deprecated legacy paths still present

- `scripts/enqueue_listing_prepare.ts`
  Uses hardcoded `.env.local` loading and duplicates canonical `pnpm ops:autonomous prepare`.
- `scripts/run_listing_prepare_direct.ts`
- `scripts/run_listing_prepare_direct.sh`
- `scripts/run_listing_monitor_direct.ts`

These should not gain new callers.

## Sensitive env surface

- Canonical runtime files: `.env`, `.env.active.json`, `.env.dev`, `.env.prod`
- Compatibility-only: `.env.local`
- Sensitive compatibility/export surfaces: `.env.vercel`, `codex*.private`, `railway_worker.env`

Use:

- `pnpm env:dev`
- `ALLOW_PROD_ENV_SWITCH=true pnpm env:prod`
- `pnpm env:status`
- `pnpm db:status`
- `pnpm runtime:diag`

## Retirement policy

- Deleted duplicate warning wrappers and versioned aliases must not be recreated.
- New operational entrypoints must land behind an existing canonical package command unless there is a documented reason they are engineering-only.
- Do not add `_latest`, `_v2`, `_v3`, or duplicate shell wrappers around existing Node/TS scripts.

See [operational-surface.md](/workspaces/quickaibuy-engine/docs/system/automation/operational-surface.md) for the full inventory and command model.
