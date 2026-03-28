# Admin Control Panel (v1)

## Purpose

The admin control panel provides explicit operator controls for safety-critical QuickAIBuy workflows.
Upstream quick actions are queue-based: they enqueue jobs to the canonical jobs queue and do not execute long-running pipeline logic inline in the HTTP request.

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

Use `.env.local` for operational rollout tuning:

- `LISTING_PREPARE_LIMIT_PER_RUN`
- `LISTING_PROMOTE_LIMIT_PER_RUN`
- `LISTING_RATE_LIMIT_15M`, `LISTING_RATE_LIMIT_1H`, `LISTING_RATE_LIMIT_1D`
- `AUTO_PURCHASE_LIMIT_PER_RUN`
- `AUTO_PURCHASE_RATE_LIMIT_1H`, `AUTO_PURCHASE_RATE_LIMIT_1D`
- alert thresholds (`ALERT_*`) for failure/block/spike detection

## Runbook Reference Surface (New)

Critical runbook procedures may be surfaced in admin at:

- `/admin/control/runbook`

v1 constraints:
- read-only informational guidance only
- no automated actions
- no implicit override toggles

Canonical procedures remain documented in `docs/operator-runbook.md`.

## Runtime Truth Notes

- Control quick actions for supplier scan/match/profit now enqueue onto `JOBS_QUEUE_NAME`.
- Worker execution truth must be observed in `worker_runs` (`worker = jobs.worker`), not inferred from static row timestamps.
- Monitoring Dashboard freshness cards separate freshness from actionability:
  - supplier and marketplace stages reflect current snapshot freshness coverage
  - profitability reflects whether profitable candidates have fresh supplier/marketplace/calc inputs
  - `actionableFreshCandidates` remains a separate headline metric and can be `0` even when profitability freshness is healthy, for example when candidates are already covered by `ACTIVE` listings
- Historical superseded snapshots should be removed only through audited cleanup scripts under `scripts/sql/`; do not manually delete current canonical rows from the dashboard symptoms alone.
