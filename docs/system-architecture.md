# QuickAIBuy System Architecture

## Stale Data Recovery Contract (v1)

### Status

Approved architecture contract.

### Scope

This document defines official QuickAIBuy v1 behavior when listing publish attempts are blocked due to:
- stale marketplace data
- supplier drift
- supplier freshness failure
- combined marketplace + supplier failure

The contract preserves fail-closed behavior and explicit human approval for controlled publishing.

### Core Principles

- **Fail-closed publish safety**: Listings must never be published when marketplace or supplier inputs are stale or unsafe.
- **Explicit operator control**: Publish eligibility restoration must be explicit and auditable in v1.
- **No hidden queue movement**: Blocked listings must not automatically move back into the publish queue.
- **Auditability first**: Blocking and recovery steps must emit structured audit events.

### Blocking Conditions

#### 1) Stale Marketplace Snapshot

Marketplace price data exceeds freshness threshold.

Typical causes:
- scanner snapshot older than freshness window
- incomplete marketplace scan
- listing candidate created from outdated snapshot

#### 2) Supplier Drift / Supplier Freshness

Supplier-side price or availability is unsafe.

Examples:
- supplier price drift exceeds threshold
- supplier snapshot exceeds freshness window
- supplier availability changed

#### 3) Combined Failure

Both marketplace freshness and supplier freshness are unsafe.

Combined failures are compound blocks and both conditions must be cleared before listing eligibility can be restored.

### Publish Worker Behavior

When a publish worker encounters a blocked listing:
1. stop before any marketplace API call
2. write a block audit event
3. enqueue refresh jobs for relevant datasets
4. leave listing non-live and out of publish queue

### State Transition Contract

Allowed transitions:

```text
READY_TO_PUBLISH
   ↓
PUBLISH_IN_PROGRESS
   ↓
BLOCKED_STALE_DATA
   ↓
PUBLISH_FAILED
```

or:

```text
READY_TO_PUBLISH
   ↓
PUBLISH_FAILED
```

Key guarantee: blocked listings must never transition directly to `ACTIVE`.

### Refresh Job Behavior

Refresh jobs are automatically enqueued when a block occurs.

- Marketplace block → `MARKETPLACE_PRICE_SCAN`
- Supplier block → `SUPPLIER_PRODUCT_REFRESH`
- Combined block → both jobs

Refresh jobs only update input data; they must not change publish state.

### Re-Evaluation Behavior

After refresh completion, data may be fresh, but **v1 requires operator-triggered re-evaluation**.

The system must not automatically re-run publish evaluation.

Reason: prevents hidden queue movement and preserves operational visibility.

### Restore Eligibility Contract

A listing may be re-promoted to `READY_TO_PUBLISH` only when all are true:
- marketplace data is fresh
- supplier data is fresh
- supplier drift is acceptable
- Price Guard passes
- listing candidate remains valid
- operator explicitly re-promotes

If any condition fails, listing remains blocked.

### Audit Event Model

Required events include:
- `LISTING_BLOCKED_STALE_MARKETPLACE_DATA`
- `MARKETPLACE_REFRESH_ENQUEUED`
- `LISTING_BLOCKED_SUPPLIER_DRIFT`
- `SUPPLIER_REFRESH_ENQUEUED`
- `LISTING_REEVALUATION_REQUESTED`
- `LISTING_REEVALUATION_COMPLETED`
- `LISTING_READY_REPROMOTED_BY_OPERATOR`

Combined blocks must record both relevant block events.

Required payload fields:
- `listing_id`
- `candidate_id`
- `marketplace_key`
- `block_reason`
- `supplier_drift_pct` (when relevant)
- `snapshot_age_hours`
- `actor_type`
- `timestamp`
- `job_id` (when refresh is triggered)

Actor types: `WORKER`, `SYSTEM`, `ADMIN`.

### Listing Monitor Worker Boundary

The monitor worker is observational only.

Allowed:
- detect stuck listings
- detect repeated failures
- surface stale listings to admin

Not allowed:
- auto-promote listings
- auto-trigger publish retries
- auto-restore publish eligibility

### System-Level Runbook Reference

Operational incident handling is defined in `docs/operator-runbook.md`.

The runbook formalizes v1 incident response for:
- manual overrides
- listing recovery procedures
- order purchase safety procedures
- override audit requirements
- resume checklist

This architecture and the runbook must stay aligned on v1 guarantees: **fail-closed, operator-driven, fully auditable**.

### Pipeline Impact

- Price Guard
- Listing Execution Worker
- Marketplace Scanner
- Supplier Crawlers
- Listing Monitor Worker
- Admin Control Panel
- Listing Promotion Tools

### Decision Record

- Re-evaluation after refresh is operator-triggered in v1.
- Automated recovery remains intentionally limited in v1.

### Next Implementation Actions

- enforce explicit block state handling in publish worker
- emit required audit events
- integrate refresh enqueue behavior
- keep explicit re-promotion tooling
- provide admin visibility for blocked listings and override status
- optionally surface read-only runbook guidance in admin
