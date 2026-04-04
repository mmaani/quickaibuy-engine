# QuickAIBuy Operator Runbook (v1)

## Status

Approved v1 runbook for daily operations and incident response.

## Purpose

This runbook defines how operators interact with QuickAIBuy each day and how incidents must be handled safely.

QuickAIBuy v1 operations are intentionally:
- fail-closed
- operator-driven
- fully auditable

The runbook assumes operators may have zero technical experience. Procedures must therefore be explicit, safe-by-default, and documented.

## Worker Role Quick Reference

When operators run workers from the terminal, use this command mapping:
- `pnpm worker:jobs`: generic BullMQ queue consumer (including queued `supplier-discover` jobs).
- `pnpm worker:engine:dev`: engine/runtime boot path after `pnpm env:dev`; not the generic queue consumer.
- `pnpm worker:engine:prod`: engine/runtime boot path after `ALLOW_PROD_ENV_SWITCH=true pnpm env:prod`; not the generic queue consumer.

If your goal is to consume queued jobs, run `pnpm worker:jobs`.

## Canonical command model

- Daily operation: `pnpm ops:full-cycle`
- Scoped backbone phases: `pnpm ops:autonomous diagnostics_refresh|prepare|publish`
- Learning refresh: `pnpm ops:learning-refresh`
- Supplier wave / discovery rebuild: `pnpm ops:supplier-wave`
- Runtime diagnostics: `pnpm runtime:diag`
- Live integrity diagnostics: `pnpm check:live-integrity`

Do not run direct prepare/promote/publish scripts manually for routine operation.

## Section 1 — Daily Operating Flow

Operators use four primary admin surfaces.

### Admin Control Panel

- **Route:** `/admin/control`
- **Purpose:** Monitor overall system health.
- **Daily checks:**
  - override status
  - publish worker health
  - scanner health
  - supplier crawler status
  - order pipeline status

The control panel should be the first page operators open each day.

### Listing Review Queue

- **Route:** `/admin/review`
- **Purpose:** Approve or reject candidate listings before publishing.
- **Operator tasks:**
  1. verify product match accuracy
  2. verify images and titles are correct
  3. confirm Price Guard margin looks reasonable
  4. approve listing candidate

Approved candidates move into listing preparation.

### Listing Management

- **Route:** `/admin/listings`
- **Purpose:** Manage listings prepared for marketplace publication.
- **Operator tasks:**
  - verify `READY_TO_PUBLISH` listings
  - investigate `PUBLISH_FAILED` listings
  - monitor `ACTIVE` listings
  - re-promote listings after safety blocks when appropriate

### Order Operations

- **Route:** `/admin/orders`
- **Purpose:** Manage incoming orders and purchase safety checks.
- **Operator tasks:**
  - verify purchase safety
  - confirm supplier availability
  - approve or cancel purchase steps

**v1 rule:** Orders must never be auto-purchased without operator review.


## Section 1.5 — Controlled Operations + Learning Loop (Initial Real Phase)

This phase prioritizes learning over scale. Do not weaken safety gates and do not remove caps.

### Rollout constraints

- listing previews prepared per run: 10–20 (default target: 20)
- listings promoted per run: 5–10 (default target: 10)
- publish attempts per day: 10–20 (default target: 15)
- auto-purchase: OFF (keep `PAUSE_AUTO_PURCHASE` enabled)

### Daily loop

1. Prepare listings.
2. Review candidates.
3. Approve a small subset.
4. Publish guarded subset.
5. Monitor outcomes and failures.

### Order validation (first live orders)

For early live orders, operators must complete manual-assisted purchasing and confirm:
- correct product identity
- correct supplier identity
- stock availability at purchase time
- payment flow completion

Operators must log mismatches, supplier issues, and delays before considering automation expansion.

### KPI pack to update daily

- listings prepared/promoted/published
- sales count
- conversion rate
- profit per order
- stock-block rate
- profit-block rate
- supplier reliability score/events
- repeat customer rate

### Daily adjustment loop

Use KPI outcomes and rejection reasons to tune:
- match scoring weights
- supplier prioritization
- listing content quality

Scale volume only after stable performance over consecutive days.

## Section 2 — Incident Response Rules

QuickAIBuy provides four emergency overrides. Operators must leave an incident note whenever an override is enabled.

### `PAUSE_PUBLISHING`

- **Purpose:** Stop listing publish workers.
- **Use when:**
  - incorrect listings are being published
  - marketplace API responses appear corrupted
  - pricing logic may be incorrect
  - unexpected publish behavior is detected
- **Effect:**
  - publish workers stop executing
  - `READY_TO_PUBLISH` listings remain queued
  - scanner and crawlers continue operating

### `PAUSE_MARKETPLACE_SCAN`

- **Purpose:** Stop marketplace price scanner.
- **Use when:**
  - scanner produces invalid price data
  - marketplace API parsing fails
  - marketplace API rate limits are triggered
- **Effect:**
  - marketplace snapshots stop updating

### `PAUSE_ORDER_SYNC`

- **Purpose:** Stop order ingestion and fulfillment synchronization.
- **Use when:**
  - duplicate orders are detected
  - supplier purchase pipeline is unstable
  - order automation behaves incorrectly

### `EMERGENCY_READ_ONLY`

- **Purpose:** Global system protection.
- **Use when:**
  - data corruption risk exists
  - unexpected destructive operations are detected
  - major system malfunction occurs
- **Effect:**
  - all write operations are disabled
  - workers refuse state transitions
  - system becomes monitoring-only

## Section 3 — Listing Recovery Procedures

Listings may be blocked for safety reasons.

### Stale Marketplace Block

- **Cause:** Marketplace price snapshot older than freshness threshold.
- **Procedure:**
  1. confirm marketplace scanner is running
  2. confirm refresh job was triggered
  3. wait for fresh marketplace snapshot
  4. re-evaluate listing economics
  5. operator may re-promote listing to `READY_TO_PUBLISH`

### Supplier Drift Block

- **Cause:** Supplier price changed outside acceptable margin threshold.
- **Procedure:**
  1. verify supplier crawler refreshed data
  2. confirm supplier price change
  3. recompute margin
  4. operator review required before re-promotion

### Supplier Availability Block

- **Cause:** Supplier availability is uncertain or missing.
- **Procedure:**
  1. confirm supplier product availability
  2. refresh supplier snapshot
  3. verify stock availability
  4. operator review required before re-promotion

### Supplier Ship-From Block

- **Cause:** Supplier origin remains unresolved or shipping truth is not deterministic.
- **Procedure:**
  1. confirm the block reason is `MISSING_SHIP_FROM_COUNTRY` or equivalent shipping-origin failure
  2. refresh supplier evidence through the canonical worker-backed path
  3. prefer richer supplier-native logistics endpoints when available
  4. do not substitute seller base country for supplier ship-from country
  5. keep the listing blocked until deterministic origin evidence is present

**v1 rule:** Listings must never automatically reenter the publish queue.

## Section 4 — Order Safety Procedures

Orders require operator verification before purchase execution.

### Purchase Safety Review

Operators must verify:
- supplier availability
- supplier price freshness
- margin remains acceptable
- product identity matches listing

### Stale Supplier Data

If supplier data is stale:
1. refresh supplier snapshot
2. verify supplier availability before approving purchase

### Supplier Drift

If supplier price changed:
1. recompute margin
2. verify order profitability
3. operator may cancel purchase if economics are unsafe

### Low Confidence / Unknown Availability

If supplier availability confidence is low:
1. operator must verify supplier stock manually
2. order must not execute until availability is confirmed

## Section 5 — Resume Procedures

Before disabling any override, operators must verify system safety.

### System Health Checklist

1. **publish safety**
   - Price Guard calculations working
   - listing margins valid
2. **marketplace scanner**
   - snapshots updating normally
   - no scanner errors
3. **supplier crawlers**
   - supplier data fresh
   - drift detection functioning
4. **order pipeline**
   - order ingestion stable
   - supplier purchase steps functioning

Only after these checks pass should overrides be disabled.

## Section 6 — Audit Requirements

Operators must record an incident note when performing critical actions.

Minimum audit fields:
- `timestamp`
- `operator_id`
- `action_taken`
- `reason`
- `incident_reference`
- `resolution_notes`

Examples:

```text
OVERRIDE_ENABLED
override = PAUSE_PUBLISHING
reason = suspected incorrect margin calculations

OVERRIDE_DISABLED
resolution = margin calculations verified safe
```

Re-promoting listings after safety blocks must also be logged.

## Pipeline Impact

This runbook governs operator behavior across:
- Admin Control Panel
- Listing Review Queue
- Listing Management
- Order Operations
- Listing Execution Worker
- Marketplace Scanner
- Supplier Crawlers
- Order Automation Worker
- Listing Monitor Worker

## Decision Made

The runbook defines:

- daily operational flow
- incident response procedures
- listing recovery procedures
- order safety procedures
- override usage rules
- audit logging requirements
- escalation ladder for operators

The runbook is written so **non-technical operators can safely operate the system**.

---

# Safety Model

The platform is designed to **fail safely and keep operator control**.

Key safety properties:

- review gate remains required
- eBay publish flow is guarded and rate-limited
- duplicate listing protections are enforced
- listing economics are protected by Price Guard
- stale marketplace data blocks listing promotion
- supplier price drift blocks unsafe listings
- supplier availability checks protect order purchase

Manual overrides exist for incident response:

- `PAUSE_PUBLISHING`
- `PAUSE_MARKETPLACE_SCAN`
- `PAUSE_ORDER_SYNC`
- `EMERGENCY_READ_ONLY`

Override state is:

- persisted in the database
- fully audit logged
- visible in `/admin/control`

For operational procedures see:

QuickAIBuy v1 operations follow:
- fail-closed behavior
- operator-driven approvals
- full auditability

Automation remains limited in v1 to reduce operational risk.

## Next Action

Monitoring Dashboard work should surface:
- override status
- blocked listings
- stale data backlog
- supplier drift alerts
- order purchase safety alerts

These indicators should help operators detect incidents quickly.

## Hub Recommendation

**Documentation-first in v1.**

Later versions may surface the most critical procedures directly in the admin control panel.
