# Order Automation: Purchase Safety Hook Scope (smallest safe v1 prep)

## Intent

Prepare order automation for future supplier purchase execution **without** implementing supplier API purchasing and **without** changing the manual-assisted boundary.

This scope reuses existing stale/drift safety concepts already used in publish flow (Price Guard / freshness / drift) and keeps order UX beginner-friendly.

## Source-of-truth constraints

- Keep current order architecture and manual operator workflow intact.
- Do not auto-purchase in this phase.
- Avoid adding broad workflow states unless strictly needed.
- Reuse existing profit/safety logic where possible (`validateProfitSafety`, stale snapshot checks, drift checks).

## Recommended hook points

### 1) Pre-approval visibility hook (read-only)

**Where:** `/admin/orders` detail load path (`getAdminOrderDetail` + operator hints panel).

**What to run:** read-only order purchase safety preview using existing Price Guard logic in `mode: "order"` when enough candidate linkage exists.

**Why:** lets operators see stale/drift risk before approval, but preserves manual decision boundary.

### 2) Approval-time gate hook (manual boundary still intact)

**Where:** `approveOrderForPurchase` path.

**What to do:** require a recent safety check result (or run it inline) and fail-closed when block-level stale/drift/profit reasons are present.

**Why:** keeps current manual flow but ensures approvals are not granted against clearly unsafe economics.

### 3) Future purchase execution gate (automation-ready hook)

**Where:** future supplier purchase executor entrypoint (not implemented now).

**What to require:** always re-run fresh supplier validation at execution time (stale/freshness + drift + profit thresholds), never rely only on approval-time validation.

**Why:** supplier drift between approval and execution is high-risk; execution must be protected with a fresh fail-closed check.

## Recommended operator-visible placeholders in `/admin/orders`

Use text-only, beginner-friendly labels (no broad new status model required):

- **Purchase safety:** `Not checked yet`
- **Purchase safety:** `Checked - pass`
- **Purchase safety:** `Checked - manual review`
- **Purchase safety:** `Blocked - stale supplier data`
- **Purchase safety:** `Blocked - supplier drift`
- **Purchase safety:** `Blocked - economics out of bounds`

Keep existing order workflow statuses as-is; show these as a compact “Safety check” panel + hint line instead of introducing many new order states.

## Minimal design hooks to add now (for Codex Spark)

1. Add a small order-facing adapter module:
   - suggested path: `src/lib/orders/purchaseSafety.ts`
   - responsibility: map order context to existing `validateProfitSafety(..., mode: "order")`, normalize reasons for UI/action gating.

2. Add a lightweight persistence hook for last safety check metadata (optional minimal DB extension):
   - fields: `checked_at`, `decision`, `reason_codes`, `input_snapshot_ts`.
   - can be attached to `supplier_orders` latest attempt row or a narrow `order_events` payload first for minimalism.

3. Add approval action guard:
   - in `approveOrderForPurchase`, call adapter and block approval on block-level reasons.
   - return operator-readable guidance (“Refresh supplier data, then re-check”).

4. Add read-only `/admin/orders` placeholder rendering:
   - display latest safety summary and age (“checked 8m ago”).
   - if missing check, show “Not checked yet”.

## Minimal implementation plan (smallest safe sequence)

1. **Adapter only + unit tests** (no workflow/state change).
2. **Read-only UI placeholders** on `/admin/orders`.
3. **Approval-time fail-closed guard** using same adapter.
4. Defer supplier API purchasing until separate milestone.

## Risks / overbuild warnings

- **Overbuild risk:** introducing many new order statuses now will confuse operators and couple UI too early.
- **Overbuild risk:** creating a parallel safety engine for orders; prefer single shared guard concepts from publish flow.
- **Operational risk:** allowing approval-time checks to be considered sufficient for later execution.

## Direct answer to execution-time validation question

**Yes.**
Every supplier purchase execution should require **fresh supplier validation** at execution time.

Approval-time economics are necessary but not sufficient; stale/drift can change between review and execution, so execution must re-check and fail closed when unsafe.
