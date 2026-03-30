# Admin Control Panel (v1)

## Purpose

The admin control panel provides explicit operator controls for safety-critical QuickAIBuy workflows.
Quick actions are aligned to shared runtime/library functions. They do not call hidden legacy scripts. Queue-based actions still enqueue through canonical helpers, and synchronous actions call the same backbone/full-cycle functions used by canonical CLI commands.

## Manual Override Controls

Supported overrides:
- `PAUSE_PUBLISHING`
- `PAUSE_LISTING_PREPARATION`
- `PAUSE_MARKETPLACE_SCAN`
- `PAUSE_ORDER_SYNC`
- `PAUSE_AUTO_PURCHASE`
- `PAUSE_SUPPLIER_CJ`
- `EMERGENCY_READ_ONLY`

Overrides are incident-use only and all actions must be audited.

## Controlled Scale Rollout Knobs

Use the active runtime env managed by `pnpm env:dev` or `pnpm env:prod` for operational rollout tuning. `.env.local` is only the generated compatibility mirror.

- `LISTING_PREPARE_LIMIT_PER_RUN`
- `LISTING_PROMOTE_LIMIT_PER_RUN`
- `LISTING_RATE_LIMIT_15M`, `LISTING_RATE_LIMIT_1H`, `LISTING_RATE_LIMIT_1D`
- `AUTO_PURCHASE_LIMIT_PER_RUN`
- `AUTO_PURCHASE_RATE_LIMIT_1H`, `AUTO_PURCHASE_RATE_LIMIT_1D`
- alert thresholds (`ALERT_*`) for failure/block/spike detection

Initial real-operations defaults for the first controlled phase:
- prepare cap per run: `20`
- promote cap per run: `10`
- live publish attempts per day cap: `15` (must stay within 10–20)
- auto-purchase: keep `PAUSE_AUTO_PURCHASE` enabled (manual-assisted ordering)

Do not remove caps or weaken safety gates during this phase.

## Runbook Reference Surface (New)

Critical runbook procedures may be surfaced in admin at:

- `/admin/control/runbook`

v1 constraints:
- read-only informational guidance only
- no automated actions
- no implicit override toggles

Canonical procedures remain documented in `docs/operator-runbook.md`.

## Runtime Truth Notes

- Control quick actions for autonomous refresh/prepare/full-cycle and learning refresh now call canonical shared runtime functions directly.
- Queue-triggered quick actions still enqueue onto `JOBS_QUEUE_NAME`.
- Worker execution truth must be observed in `worker_runs` (`worker = jobs.worker`), not inferred from static row timestamps.
- Monitoring Dashboard freshness cards separate freshness from actionability:
  - supplier and marketplace stages reflect current snapshot freshness coverage
  - profitability reflects whether profitable candidates have fresh supplier/marketplace/calc inputs
  - `actionableFreshCandidates` remains a separate headline metric and can be `0` even when profitability freshness is healthy, for example when candidates are already covered by `ACTIVE` listings
- Historical superseded snapshots should be removed only through audited cleanup scripts under `scripts/sql/`; do not manually delete current canonical rows from the dashboard symptoms alone.

## First Live Test Loop (Daily)

1. Trigger listing preparation from `/admin/control`.
2. Review candidates in `/admin/review` and approve only a small subset.
3. Prepare and promote approved listings in `/admin/listings` within per-run caps.
4. Publish guarded subset and verify publish diagnostics.
5. Monitor outcomes in `/admin/control` and `/admin/orders`.

Track daily in operator notes:
- approval rate
- publish success rate
- top rejection reasons
- stock blocks and profit blocks
- supplier reliability incidents

For first real orders, keep auto-purchase paused and require manual purchase verification (product, supplier, stock, payment flow).
