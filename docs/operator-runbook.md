# QuickAIBuy Operator Runbook (v1)

## Status

Approved operational runbook for incident response.

## Purpose

This runbook defines the required operator procedures when system safety conditions trigger blocks, manual overrides, or order safety checks.

This runbook complements the existing architecture contracts for stale data recovery, supplier drift protection, manual override controls, and order purchase safety boundaries.

QuickAIBuy v1 remains fail-closed and operator-driven.

## 1) Manual Override Usage Rules

QuickAIBuy provides four manual override controls via the admin control panel.

Overrides must only be used during operational incidents, and operators must always record a note explaining why an override was enabled.

### `PAUSE_PUBLISHING`

Stops listing publish execution workers.

Use when:
- incorrect listings are being published
- marketplace integration errors appear
- profit engine safety is suspected

Effect:
- publish workers stop execution
- scanner and crawlers continue

Recovery:
- verify listing safety before resuming

### `PAUSE_MARKETPLACE_SCAN`

Stops marketplace scanner jobs.

Use when:
- scanner produces corrupted data
- API rate-limit issues occur
- parsing failures are detected

Effect:
- new marketplace snapshots stop updating
- existing data remains available

### `PAUSE_ORDER_SYNC`

Stops order ingestion and fulfillment synchronization.

Use when:
- order pipeline errors occur
- duplicate orders appear
- supplier integration instability is detected

### `EMERGENCY_READ_ONLY`

Global safety override.

Use when:
- database integrity is at risk
- unexpected destructive behavior is observed
- major system failure occurs

Effect:
- all write operations are blocked
- workers refuse state transitions

## 2) Listing Recovery Procedures

### Block Type: Stale Marketplace Data

Cause:
- marketplace snapshot exceeded freshness threshold

Procedure:
1. verify scanner health
2. confirm refresh job queued
3. wait for fresh marketplace snapshot
4. re-evaluate economics
5. operator may re-promote listing to `READY_TO_PUBLISH`

### Block Type: Supplier Drift

Cause:
- supplier price changed outside acceptable drift threshold

Procedure:
1. verify supplier crawler refresh
2. confirm supplier price change
3. recompute margin
4. operator may re-promote listing

### Block Type: Combined Block

Cause:
- both marketplace data and supplier data are unsafe

Procedure:
1. marketplace refresh completes
2. supplier refresh completes
3. profit engine recalculates economics
4. operator review required before promotion

**v1 rule:** Listings must never auto-reenter the publish queue.

## 3) Order Safety Procedures

### Order Purchase Block Types

#### Stale Supplier Data

Procedure:
1. refresh supplier snapshot
2. verify supplier availability
3. confirm purchase cost

#### Supplier Drift

Procedure:
1. recompute margin
2. verify order profitability
3. operator may cancel order

#### Economics Blocked

If order margin becomes negative:

Procedure:
1. operator must approve override **or**
2. cancel order

**v1 rule:** The system must never auto-purchase at a loss.

## 4) Resume Procedures

Before removing overrides, operators must confirm system health.

Checklist:
1. publish safety: Price Guard functioning and listing economics valid
2. marketplace scanner: snapshots updating normally
3. supplier crawlers: supplier data fresh and drift checks functioning
4. order pipeline: order ingestion and fulfillment stable

Overrides should only be disabled after these checks pass.

## 5) Audit Requirements

Operators must record an incident note when using overrides.

Minimum audit fields:
- `timestamp`
- `operator_id`
- `override_type`
- `reason_for_override`
- `incident_reference`
- `resolution_notes`

Example audit entry:

```text
OVERRIDE_ENABLED
override = PAUSE_PUBLISHING
reason = suspected incorrect margin calculation

OVERRIDE_DISABLED
resolution = margin calculation verified safe
```

All override actions must remain permanently logged.

## Admin Control Panel Runbook Surface (New)

In addition to documentation, critical runbook procedures may be optionally visible inside the admin control panel:

- `/admin/control/runbook`

Purpose:
- provide operators with quick emergency guidance without leaving admin

v1 behavior:
- read-only and informational only
- must not automate any system behavior

## Pipeline Impact

- Listing Execution Worker
- Marketplace Scanner
- Supplier Crawlers
- Order Automation Worker
- Admin Control Panel
- Listing Monitor Worker

## Decision

QuickAIBuy v1 incident response model is:
- fail-closed
- operator-driven
- fully auditable

Automated recovery is intentionally limited in v1.

## Next Action (Auto Listing System Thread)

- reference runbook procedures when implementing retry logic
- ensure override actions generate audit events
- expose override status in admin UI
- optionally surface the runbook reference in `/admin/control`

## Hub Recommendation

**Documentation-first in v1.**

Critical procedures may later appear as contextual guidance inside the admin UI.
