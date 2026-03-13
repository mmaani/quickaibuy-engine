THREAD:
Code Review

GOAL:
Review QuickAIBuy engineering quality and risk.

FILES REVIEWED:
- Workers/queue: `src/workers/jobs.worker.ts`, `src/workers/engine.worker.ts`, `src/workers/listingExecute.worker.ts`, `src/workers/listingMonitor.worker.ts`, `src/workers/orderSync.worker.ts`, `src/workers/inventoryRisk.worker.ts`, `src/lib/jobs/enqueueInventoryRiskScan.ts`, `src/lib/jobs/enqueueMarketplacePriceScan.ts`, `src/lib/jobs/enqueueSupplierDiscover.ts`.
- Listing lifecycle: `src/lib/listings/statuses.ts`, `src/lib/listings/getListingExecutionCandidates.ts`, `src/lib/listings/publishRateLimiter.ts`, `src/lib/listings/duplicateProtection.ts`, `src/lib/listings/recovery.ts`, `src/lib/listings/resumePausedListing.ts`, `src/workers/listingExecute.worker.ts`, `src/workers/listingMonitor.worker.ts`.
- Orders/purchase safety: `src/lib/orders/manualPurchaseFlow.ts`, `src/lib/orders/purchaseSafety.ts`, `src/lib/orders/trackingSync.ts`, `src/lib/orders/operatorConsole.ts`, `src/lib/orders/transitions.ts`, `src/lib/orders/syncEbayOrders.ts`.
- Supplier/marketplace ingestion: `src/lib/jobs/supplierDiscover.ts`, `src/lib/products/supplierAvailability.ts`, `src/lib/products/suppliers/{aliexpress.ts,alibaba.ts,temu.ts}`, `src/lib/marketplaces/trendMarketplaceScanner.ts`, `src/lib/marketplaces/match.ts`.
- Scripts/migrations/diagnostics: risk-tiered pass over `scripts/` with deep focus on DB mutation, enqueue, runtime-monitoring, and migration scripts.

RESULT:
QuickAIBuy v1 has strong safety intent and practical guardrails, but there is high hidden coupling across statuses, queue orchestration, and script operations. The codebase is stable for current controlled scale; however, without policy centralization and script governance, feature velocity will increasingly trade off against operational safety.

STRENGTHS:
- Publish path is defensive (dry-run gate, live-publish env gate, fail-closed profit safety, duplicate protection, rate limiting, daily cap, audit trail).
- Inventory risk flow has explicit signal-to-action mapping with auditable outcomes (`FLAG`, `MANUAL_REVIEW`, `AUTO_PAUSE`).
- Order handling has explicit transition map and clear manual operator steps for purchase and tracking.
- Queue producers generally use deterministic job IDs, retry/backoff settings, and ledger writes.

ISSUES:
1) **CRITICAL — lifecycle/status policy is duplicated and string-based in many modules (listing + order).**
   - Evidence: listing statuses are defined centrally, but many workers/queries still hardcode status literals (`READY_TO_PUBLISH`, `PAUSED`, `ACTIVE`, etc.).
   - Evidence: order transitions are defined centrally, while sync/manual flows also hardcode status handling separately.
   - Risk: drift bugs where one code path recognizes a status that another path ignores (monitoring gaps, false eligibility, or stuck states).

2) **HIGH — `jobs.worker` is over-concentrated orchestration with repeated bookkeeping logic.**
   - Evidence: branch-by-branch duplication of run logging, ledger updates, and audit behavior.
   - Risk: adding/changing jobs is error-prone; inconsistent completion/failure semantics likely over time.

3) **HIGH — order sync performs full delete/reinsert for line items on every sync.**
   - Evidence: `syncEbayOrders` deletes all `order_items` for an order before inserting current line items.
   - Risk: churn cost grows with volume, impairs historical/item-level diagnostics, and increases contention under frequent sync.

4) **HIGH — recovery logic is partially duplicated between publish-time checks and re-evaluation path.**
   - Evidence: stale supplier/marketplace conditions and refresh enqueue behavior exist in both listing execution and recovery modules.
   - Risk: divergence in reasons/messages/actions and uneven operator guidance.

5) **MEDIUM — queue idempotency behavior is inconsistent by job type.**
   - Evidence: some jobs check in-flight overlaps; others rely solely on jobId; chained follow-up jobs do not uniformly propagate dedupe context.
   - Risk: duplicate execution under retries/manual re-runs and harder queue diagnostics.

6) **MEDIUM — script surface is large, unevenly curated, and includes overlapping variants.**
   - Evidence: multiple versioned script variants (`*_v2`, `*_v3`, `*_latest`) and similar-purpose check/run scripts.
   - Risk: operational misuse (wrong script in production), inconsistent runbooks, and onboarding friction.

7) **LOW — logging style is mixed (`console.*` vs structured logger).**
   - Risk: observability fragmentation and harder cross-worker incident correlation.

CLEANUP OPPORTUNITIES:
- Build a single lifecycle policy layer for listing and order statuses (constants + query helpers + guards) and replace scattered literals incrementally.
- Introduce a reusable `executeJob()` harness in jobs worker for standardized lifecycle logging, ledger updates, and error mapping.
- Extract shared “refresh-on-stale” helper used by both publish path and recovery re-evaluation.
- Add queue instrumentation conventions: job correlation IDs, parent-job linkage, and dedupe reason fields.
- Rationalize scripts by risk tier and ownership:
  - `check_*` read-only diagnostics,
  - `enqueue_*` controlled queue mutation,
  - `mutate_*` explicit DB state mutation,
  - `run_*` runtime/worker execution.

TEST GAPS:
- Missing targeted tests for listing publish decision matrix (paused guard, duplicate block, rate-limit block, daily-cap block, fail-closed drift rules).
- Missing regression tests for recovery path parity (publish block vs recovery re-eval produce same action/reason class).
- Missing tests for order transition legality from all operator actions (purchase record, tracking update, sync outcomes).
- Missing queue idempotency tests under duplicate enqueue/retry race conditions.
- Missing tests validating inventory risk action thresholds and false-positive resistance.

SCRIPT HYGIENE:
- **Deep review required now (high risk):**
  - DB mutation scripts (`approve_*`, `reject_*`, `promote_*`, `backfill_*`, `cleanup_*`, `reclassify_*`, `fix_*`).
  - enqueue scripts (`enqueue_*`, recurring schedule setup/removal).
  - runtime/prod diagnostics (`check_*runtime*`, `check_*publish*`, `check_*order*`, `queue_namespace_diagnostics.ts`, `check_inventory_risk_schedule.ts`).
  - migration runners (`run_migration.sh`, controlled-gate migration wrappers).
- **Light review acceptable:**
  - one-off debug probes and inspection helpers (`debug_*`, `inspect_*`, `peek-*`, ad-hoc patch scripts).
- Practical hygiene fixes:
  - Add `scripts/README.md` index with risk level, mutability, owner, and prod-safe notes.
  - Deprecate/alias overlapping variants to one canonical command per operational intent.

RECOMMENDATIONS:
1. **Fix first before next feature wave:** centralize listing/order lifecycle policy and remove scattered status literals in workers + query filters + scripts.
2. Add a shared jobs-worker execution wrapper to reduce orchestration duplication and enforce consistent run semantics.
3. Add focused high-risk tests (publish matrix, recovery parity, order transition guards, queue idempotency races).
4. Script governance pass: risk-tier catalog + canonical entrypoints + deprecation of variant scripts.
5. Optimize order sync item updates from full replace to diff/upsert once observability baselines are in place.

QUESTION TO HUB:
Which technical debt item should be fixed before expanding the next feature wave?
- **Answer:** Lifecycle/status policy centralization. It has the widest risk-reduction impact per unit effort and directly lowers regression probability in publish, recovery, monitoring, and order operations.

Should you review all scripts and functions too?
- **Answer:** Yes, but by risk. Deep-review DB-mutation/enqueue/runtime/migration scripts first; light-review one-off debug helpers afterward.
