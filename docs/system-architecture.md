# QuickAIBuy System Architecture (v1)

## Current status (2026-03-11)

- v1 stale-snapshot guarded publish path is implemented and proven in real worker flow.
- Marketplace stale block and supplier drift block are fail-closed.
- Marketplace refresh enqueue on stale block is active.
- Marketplace Price Scanner is now in v1 maintenance/bug-fix mode (no redesign in v1).

## Official stale-data recovery contract (controlled listing publish)

This contract defines fail-closed behavior when listing publish eligibility is blocked by stale marketplace data, supplier drift/freshness risk, or both.

### Safety boundary (v1)

- No broad auto-publish.
- No scanner redesign.
- Human approval remains the publish safety boundary.
- Re-entry to publish must be explicit and auditable.

## A) Stale marketplace block

When a publish attempt is blocked because marketplace data is stale:

- Publish must stop **before** any live publish action.
- Listing must not advance to `ACTIVE`.
- Listing remains non-live.
- Marketplace refresh job is enqueued.
- Audit trail records:
  - stale block detected
  - refresh job requested/enqueued
  - listing/candidate left non-live

### State behavior (v1)

- If still pre-execution, keep in `READY_TO_PUBLISH` **only if worker has not claimed it**.
- If worker already claimed execution, move to `PUBLISH_FAILED` with explicit stale-data reason.
- Never silently return row to live execution flow.
- Never auto-promote back after refresh.

Operational meaning:

- Listing/candidate is temporarily unsafe to publish.
- Refresh has been requested.
- Human/operator decides next step after fresh data exists.

## B) Supplier drift block

When a publish attempt is blocked because supplier drift/freshness is unsafe:

- Publish must stop **before** any live publish action.
- Listing remains non-live.
- Supplier revalidation/refresh path is triggered when available.
- Audit trail records:
  - supplier drift block detected
  - refresh/recheck requested
  - listing/candidate left non-live

### State behavior (v1)

- Supplier drift lands in the same non-live fail-closed path as stale marketplace block.
- No continued publish movement.
- No auto-retry publish.

## C) Combined failure (marketplace + supplier)

If both checks fail:

- Treat as a combined fail-closed block.
- Enqueue required refresh/revalidation for **both** sides.
- Write both reasons in audit details.
- Listing remains non-live.
- Re-evaluation waits until **both** conditions are healthy.

Priority rule:

- Combined failure is not an override case.
- Both issues must clear before publish eligibility can return.

## Audit trail contract

### Required conceptual events

Stale marketplace block:

- `LISTING_BLOCKED_STALE_MARKETPLACE_DATA`
- `MARKETPLACE_REFRESH_ENQUEUED`

Supplier drift block:

- `LISTING_BLOCKED_SUPPLIER_DRIFT`
- `SUPPLIER_RECHECK_ENQUEUED` (or equivalent supplier refresh event)

Combined block:

- Either both block events separately, or one combined event carrying both reasons.

Re-evaluation / re-entry:

- `LISTING_REEVALUATION_REQUESTED`
- `LISTING_REEVALUATION_COMPLETED`
- `LISTING_READY_TO_PUBLISH_RESTORED` (only when explicitly restored)
- `LISTING_READY_REPROMOTED_BY_OPERATOR` (manual re-promotion)

### Minimum audit details

- listing id
- candidate id
- marketplace key
- stale/freshness reason
- supplier drift reason (when present)
- refresh job ids / queue keys (when available)
- actor type (`WORKER`, `SYSTEM`, `ADMIN`)
- whether re-entry was manual vs automated

## Refresh enqueue behavior (v1)

Refresh enqueue is automatic when a block is detected because enqueueing refresh is safe and does not publish.

- stale marketplace block → enqueue marketplace refresh job
- supplier drift block → enqueue supplier revalidation/refresh job (if available)

This only refreshes inputs and does not restore live publish flow.

## Re-evaluation behavior (v1)

**Decision:** Operator-triggered in v1; automation deferred.

Flow:

- stale/drift block detected
- refresh/recheck enqueued automatically
- listing/candidate stays non-live
- operator reviews fresh result
- operator re-promotes when appropriate

Rationale:

- Automatic re-evaluation creates hidden queue movement.
- Hidden movement conflicts with controlled publishing for v1.

After refresh completes, system may update snapshots/candidate inputs, but must not auto-return listing to publish execution in v1.

## Responsibility split (v1)

- Refresh jobs update input data.
- Profit Engine / candidate evaluation tools recalculate as needed.
- Operator confirms and re-promotes when appropriate.
- Publish worker is **not** the hidden re-evaluation orchestrator.

## Restoring `READY_TO_PUBLISH` eligibility

Eligibility returns only when all are true:

- marketplace data is fresh
- supplier drift/freshness is acceptable
- candidate still passes Price Guard / safety checks
- candidate remains approved/listing-eligible
- operator explicitly re-promotes (v1)

Restore flow:

- stale/drift block
- refresh/recheck jobs run
- fresh data available
- candidate re-evaluated
- operator confirms
- listing restored/recreated to `READY_TO_PUBLISH`

## Re-promotion rule (v1)

Re-promotion is operator-triggered.

- No automatic direct requeue to publish from blocked state.
- Preserving the old listing row is acceptable if state transitions are explicit and audited, and operator action is required.
- Recreating a fresh `PREVIEW` then promoting is also acceptable if explicit and auditable.

## Listing monitor role (v1)

Listing monitor is observational in stale-data recovery.

It may:

- surface stale `PUBLISH_IN_PROGRESS`
- surface repeated `PUBLISH_FAILED`
- surface `ACTIVE` rows missing external ids
- surface blocked/non-recovered listings for operations visibility

It must not:

- auto-re-promote listings
- auto-trigger publish retries
- bypass review/approval boundary

## v1 boundary vs later automation

### v1 boundary

- block publish on stale marketplace data or supplier drift
- auto-enqueue refresh/recheck jobs
- keep listing non-live
- require operator review/re-promotion
- maintain complete audit trail
- preserve fail-closed behavior

### Later phase (not v1)

- auto re-evaluation after successful refresh
- auto restore publish eligibility when all checks pass
- auto requeue for publish

## Pipeline impact

- Marketplace Scan
- Profit Engine / Price Guard
- Listing Execution
- Listing Monitor
- `/admin/control`
- operator review/re-promotion flow

## Official decision record

Stale block or supplier drift block:

1. publish stops
2. refresh/recheck job enqueued automatically
3. candidate/listing remains non-live
4. fresh data produced
5. operator reviews
6. operator re-promotes when appropriate

Additional decision:

- combined marketplace stale + supplier drift requires both to clear
- re-evaluation after refresh is operator-triggered in v1
- automatic re-evaluation deferred to later phase

## Operational next actions

- Run refresh jobs on cadence and monitor stale/fresh ratios.
- Keep stale/drift block paths observable via audit and control-panel views.
- Apply bug fixes only for v1 scanner behavior; defer redesign to later phase.
- Continue architecture work on guarded re-run behavior and publish/monitor worker contracts.

## Answer to hub question

Should v1 re-evaluation after successful refresh be automatic, or operator-triggered?

**Recommended/official v1 answer: operator-triggered in v1, automatic later.**
