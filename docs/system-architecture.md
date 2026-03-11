QuickAIBuy System Architecture
Stale Data Recovery Contract (v1)
Status

Approved architecture contract.

Scope

This document defines the official QuickAIBuy v1 behavior when a listing publish attempt is blocked due to:

stale marketplace data

supplier price drift

supplier freshness failure

combined marketplace + supplier failure

The contract preserves fail-closed behavior and maintains the human approval boundary required for controlled publishing.

Core Principles

QuickAIBuy v1 operates under the following safety rules:

Fail-Closed Publish Safety

Listings must never be published when marketplace or supplier inputs are stale or unsafe.

Explicit Operator Control

Publish eligibility restoration must always be explicit and auditable in v1.

No Hidden Queue Movement

The system must never automatically move blocked listings back into the publish queue.

Auditability First

All blocking decisions and recovery steps must produce structured audit events.

Blocking Conditions

A listing publish attempt may be blocked for the following reasons.

1. Stale Marketplace Snapshot

Marketplace price data exceeds the freshness threshold.

Typical causes:

scanner snapshot older than freshness window

marketplace price scan incomplete

listing candidate created from outdated marketplace results

2. Supplier Drift / Supplier Freshness

Supplier-side price or availability is unsafe.

Examples:

supplier price drift exceeds threshold

supplier snapshot exceeds freshness window

supplier availability changed

3. Combined Failure

Both marketplace freshness and supplier freshness are unsafe.

Combined failures must be treated as compound blocks.

Both conditions must be cleared before the listing becomes publish-eligible again.

Publish Worker Behavior

When a publish worker encounters a blocked listing:

Step 1 — Stop Publish

The worker must immediately stop before any marketplace API call.

Step 2 — Write Audit Event

An audit event must be written describing the block.

Step 3 — Enqueue Refresh

A refresh job should be automatically enqueued for the relevant dataset.

Step 4 — Leave Listing Non-Live

The listing must remain non-live and must not re-enter the publish queue automatically.

State Transition Contract

The system must maintain explicit state transitions.

Allowed Transitions
READY_TO_PUBLISH
   ↓
PUBLISH_IN_PROGRESS
   ↓
BLOCKED_STALE_DATA
   ↓
PUBLISH_FAILED

or

READY_TO_PUBLISH
   ↓
PUBLISH_FAILED

depending on implementation detail.

The key guarantee:

Blocked listings must never transition directly to ACTIVE.

Refresh Job Behavior

Refresh jobs are automatically enqueued when a block occurs.

Marketplace Block

Enqueue:

MARKETPLACE_PRICE_SCAN
Supplier Block

Enqueue:

SUPPLIER_PRODUCT_REFRESH
Combined Block

Both refresh jobs must be enqueued.

Refresh jobs only update input data.

Refresh jobs must not change publish state.

Re-Evaluation Behavior

After refresh jobs complete:

new marketplace data may exist

new supplier data may exist

However:

v1 Rule

Re-evaluation must be operator-triggered.

The system must not automatically re-run publish evaluation.

Reason:

Automatic re-evaluation would introduce hidden queue movement and reduce operational visibility.

Restore Eligibility Contract

A listing becomes eligible for promotion back to READY_TO_PUBLISH only when:

marketplace data is fresh

supplier data is fresh

supplier drift is acceptable

price guard passes

listing candidate remains valid

operator explicitly re-promotes

If any condition fails, the listing must remain blocked.

Audit Event Model

Every blocking and recovery step must produce structured audit events.

Required Events
Marketplace Block
LISTING_BLOCKED_STALE_MARKETPLACE_DATA
MARKETPLACE_REFRESH_ENQUEUED
Supplier Drift Block
LISTING_BLOCKED_SUPPLIER_DRIFT
SUPPLIER_REFRESH_ENQUEUED
Combined Block

Both block events must be recorded.

Recovery
LISTING_REEVALUATION_REQUESTED
LISTING_REEVALUATION_COMPLETED
LISTING_READY_REPROMOTED_BY_OPERATOR
Audit Payload Requirements

Every audit event must include:

listing_id
candidate_id
marketplace_key
block_reason
supplier_drift_pct (if relevant)
snapshot_age_hours
actor_type
timestamp
job_id (if refresh job triggered)

Actor types:

WORKER
SYSTEM
ADMIN
Listing Monitor Worker

The monitor worker must remain observational only in this architecture.

The monitor worker may:

detect stuck listings

detect repeated failures

surface stale listings to admin control panel

The monitor worker must not:

auto-promote listings

auto-trigger publish retries

auto-restore publish eligibility

Safe v1 Boundary

v1 must preserve explicit operator control.

The recovery flow is therefore:

stale/drift block
        ↓
refresh job enqueued
        ↓
fresh data produced
        ↓
operator reviews
        ↓
operator re-promotes listing
        ↓
publish worker may attempt publish again

No automated recovery occurs in v1.

Pipeline Impact

This contract affects the following system components:

Price Guard

Listing Execution Worker

Marketplace Scanner

Supplier Crawlers

Listing Monitor Worker

Admin Control Panel

Listing Promotion Tools

Decision Record

Decision:

Re-evaluation after refresh is operator-triggered in v1.

Future version may allow automatic re-evaluation.

Next Implementation Actions

The Auto Listing System thread should implement:

explicit block state handling in publish worker

audit event generation

refresh enqueue integration

explicit re-promotion tooling

admin visibility for blocked listings

Hub Question Resolution

Should v1 re-evaluation after successful refresh be automatic or operator-triggered?

Decision:

Operator-triggered in v1.

Automatic re-evaluation may be added in later versions once publish automation is fully stabilized.

What you should do now

Send Codex:

Replace docs/system-architecture.md with the updated version provided.

No other code changes are required yet.
