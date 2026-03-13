THREAD:
Code Review

GOAL:
Review QuickAIBuy engineering quality and risk.

FILES REVIEWED:
- `src/workers/jobs.worker.ts`
- `src/workers/engine.worker.ts`
- `src/workers/listingExecute.worker.ts`
- `src/workers/listingMonitor.worker.ts`
- `src/workers/orderSync.worker.ts`
- `src/workers/inventoryRisk.worker.ts`
- `src/lib/listings/{statuses.ts,getListingExecutionCandidates.ts,publishRateLimiter.ts,duplicateProtection.ts,recovery.ts,resumePausedListing.ts}`
- `src/lib/orders/{manualPurchaseFlow.ts,purchaseSafety.ts,trackingSync.ts,operatorConsole.ts,transitions.ts,syncEbayOrders.ts}`
- `src/lib/jobs/{enqueueInventoryRiskScan.ts,enqueueMarketplacePriceScan.ts,enqueueSupplierDiscover.ts,supplierDiscover.ts}`
- `src/lib/risk/inventoryRiskMonitor.ts`
- `src/lib/products/{supplierAvailability.ts,suppliers/*}`
- `src/lib/marketplaces/{trendMarketplaceScanner.ts,match.ts}`
- `scripts/*` (risk-prioritized pass, deep on enqueue/mutation/monitoring scripts)

RESULT:
The platform is functionally mature and has strong guardrail intent, but operational safety depends on duplicated string-based policies spread across workers, order logic, and scripts. The current architecture is workable at v1 scale, but future velocity will slow unless ownership boundaries and script hygiene are tightened.

STRENGTHS:
- Listing publish flow is defensive: explicit dry-run gate, price guard fail-closed behavior, duplicate checks, publish rate limiting, and audit coverage before/after publish actions.
- Inventory risk monitor has clear action resolution (`FLAG` vs `MANUAL_REVIEW` vs `AUTO_PAUSE`) and writes consistent audit artifacts.
- Order lifecycle has explicit transition table and manual operator workflows (purchase record, tracking handoff, sync status).
- Queueing stack includes idempotency keys and retry/backoff in most enqueue paths.

ISSUES (ranked by severity):
1. **High — status/transition policy is fragmented and stringly-typed across modules.**
   - Listing status strings and order status strings are repeated in SQL literals, workers, and helper modules instead of one source of truth.
   - This creates silent drift risk (e.g., a new status added in one place not reflected in monitors, linkages, filters, or scripts).
   - Impact: production behavior divergence and hard-to-debug lifecycle dead zones.

2. **High — `jobs.worker` is a large orchestration monolith with mixed concerns.**
   - It handles scheduling checks, ledger updates, audit events, orchestration chaining, and domain logic dispatch in one file.
   - Repeated success/failure bookkeeping appears in every switch branch, increasing inconsistency risk during future edits.
   - Impact: high change risk, low readability, and easy regression when adding new jobs.

3. **High — order sync is destructive for line items on every ingest.**
   - `syncEbayOrders` deletes all `order_items` and reinserts each run.
   - This is simple but expensive and can complicate future analytics/history accuracy if item-level metadata expands.
   - Impact: scale and observability risk as order volume grows.

4. **Medium — recovery and pause semantics are safe but highly coupled to operator flow assumptions.**
   - `PAUSED` handling requires explicit resume to `PREVIEW`; listing execution also checks pause state independently.
   - Similar recovery decisions (stale marketplace/supplier and refresh enqueue behavior) are duplicated between listing execution and recovery code paths.
   - Impact: policy drift and inconsistent remediation messaging over time.

5. **Medium — queue idempotency strategy is uneven across jobs.**
   - Some paths actively check in-flight jobs; others rely only on deterministic `jobId`; others enqueue follow-up jobs without cross-job dedupe context.
   - Impact: duplicate job pressure under retry storms or manual re-runs.

6. **Medium — script surface has drift signals and version sprawl.**
   - Parallel variants (`*_v2`, `*_v3`, `*_latest`) and multiple near-equivalent runners/checkers are present.
   - Some scripts are prod-adjacent but naming does not clearly mark “safe check” vs “state mutation”.
   - Impact: operator misuse risk and onboarding friction.

7. **Low — logging consistency and ownership boundaries are mixed.**
   - Some modules use structured logger helpers while others rely on raw `console.log/error` with ad-hoc payload shapes.
   - Impact: weaker uniform observability/searchability.

CLEANUP OPPORTUNITIES:
- Introduce centralized status constants + reusable DB predicates for listing/order lifecycle queries to remove repeated SQL status lists.
- Extract a generic job wrapper in `jobs.worker` for standardized run logging, ledger transitions, and error mapping.
- Split `jobs.worker` handlers by domain (`catalog`, `listing`, `orders`, `risk`) while keeping existing queue contract unchanged.
- Consolidate duplicated stale-data refresh logic into one helper used by both publish-time block and recovery re-evaluation.
- Standardize script naming with prefixes, e.g. `check_*` (read-only), `run_*` (runtime worker), `mutate_*` (state-changing), and archive deprecated variants.

TEST GAPS:
- No clear automated test suite found for high-risk lifecycle logic (listing publish decision matrix, pause/resume recovery, inventory risk action resolution, order transition guards).
- Missing contract tests for idempotency behavior in enqueue flows and job chaining (`SCAN -> MATCH -> EVAL`).
- Missing regression tests around order sync update semantics (e.g., unchanged order should not churn related data unnecessarily).

SCRIPT HYGIENE:
- **Deep-review required scripts** (highest operational risk):
  - DB mutation scripts (`approve/reject/promote/backfill/reclassify/cleanup/fix_*`).
  - enqueue scripts (`enqueue_*`, recurring schedule management).
  - production readiness/diagnostics scripts (`check_*runtime*`, `check_*publish*`, `check_*order*`, `queue_namespace_diagnostics.ts`).
  - migration runners (`run_migration.sh`, controlled gate migration wrappers).
- **Light-review scripts**:
  - one-off debug/inspection probes (`debug_*`, `inspect_*`, `peek-*`, ad-hoc patch scripts).
- Findings:
  - Duplicate/variant script families should be rationalized (notably marketplace summary patch variants and monitor “latest” variants).
  - Script inventory is large enough that risk-tier ownership metadata should be added (owner + environment + mutability).

RECOMMENDATIONS (ranked by priority):
1. **First fix before next feature wave:** centralize lifecycle/status policy (listing + order) and replace ad-hoc string literals in workers/queries/scripts.
2. Create a reusable worker-job execution harness for consistent ledger/audit/run logging and adopt it in `jobs.worker` first.
3. Add focused tests for publish safety matrix, order transitions, and inventory risk auto-pause/manual-review resolution.
4. Rationalize scripts into risk tiers and deprecate duplicate variants; add clear README index for production-safe usage.
5. Plan a low-risk `order_items` sync optimization path (diff/upsert) before order volume increases.

QUESTION TO HUB:
Which technical debt item should be fixed before expanding the next feature wave?
- **Answer:** Centralized lifecycle/status policy should be fixed first; it reduces the largest cross-module regression risk with the smallest architectural disruption.

Should you review all scripts and functions too?
- **Answer:** Yes, but by risk tier, not exhaustive depth. Deep-review state mutation/enqueue/runtime/migration scripts first, then lightly review one-off debug helpers.
