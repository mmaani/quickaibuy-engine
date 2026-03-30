# THREAD
Phase 1 — Instruction 1 of 3

# GOAL
Canonical inspection and schema-first planning only for Phase 1 scope:
1. Self-Kill System
2. Supplier Trust Score
3. Listing Evolution

No runtime behavior changes are proposed in this document.

# PRE-FLIGHT SAFETY
- Repository identity confirmed: **QuickAIBuy** (`/workspace/quickaibuy-engine`).
- Cross-project isolation check: no Zomorod/NIVRAN architecture was used.
- DB runtime env check result: `DATABASE_URL` / `DATABASE_URL_DIRECT` were **not present** in this execution context, so this inspection is code-truth only (no live DB claims).

# FILES INSPECTED
- `src/lib/db/schema.ts`
- `src/db/schema.ts`
- `review_files/schema.ts`
- `src/lib/listings/performanceEngine.ts`
- `src/lib/listings/statuses.ts`
- `src/lib/listings/recovery.ts`
- `src/lib/listings/recoveryState.ts`
- `src/lib/listings/resumePausedListing.ts`
- `src/lib/listings/prepareListingPreviews.ts`
- `src/lib/listings/computeListingCorrectionDraft.ts`
- `src/lib/risk/inventoryRiskMonitor.ts`
- `src/lib/risk/riskSignals.ts`
- `src/lib/review/console.ts`
- `src/lib/suppliers/intelligence.ts`
- `src/lib/suppliers/telemetry.ts`
- `src/lib/listings/supplierSelection.ts`
- `src/lib/profit/supplierPriority.ts`
- `scripts/check_schema_drift.ts`
- `scripts/validate_listing_schema_alignment.mjs`
- `scripts/check_migration_baseline.ts`

# CANONICAL OWNERSHIP MAP

## 1) Self-Kill data and logic

### Listing performance signals (canonical)
- **Primary producer**: `src/lib/listings/performanceEngine.ts`
  - Pulls eBay analytics/recommendation data and stores outcomes in `listings.response.listingPerformance` JSON.
  - Tracks impressions, views, CTR, transactions, commercial state, optimization attempts, and dead-listing recovery hints.
- **Current storage truth**: nested JSON in `listings.response`, not dedicated first-class columns.

### Listing status / lifecycle policy (canonical)
- **Lifecycle status model**: `src/lib/listings/statuses.ts`
  - Transition authority for PREVIEW → READY_TO_PUBLISH → PUBLISH_IN_PROGRESS → ACTIVE / PAUSED / ENDED paths.
- **Pause/resume guardrail**: `src/lib/listings/resumePausedListing.ts`
  - Explicit resume from PAUSED to PREVIEW only.
- **Monitor-layer lifecycle checks**: `src/workers/listingMonitor.worker.ts`
  - Audits stale in-progress, repeated failures, and paused stability without overriding lifecycle contract.

### Risk interaction (canonical)
- **Inventory risk evaluator**: `src/lib/risk/inventoryRiskMonitor.ts`
  - Generates risk signals from supplier drift, availability, staleness, shipping changes.
- **Risk action authority mapping**: `src/lib/risk/riskSignals.ts`
  - Severity → action (`FLAG`, `MANUAL_REVIEW`, `AUTO_PAUSE`) is the canonical risk action map.

### Listing review / re-evaluation surfaces (canonical)
- **Operator review truth**: `src/lib/review/console.ts`
  - Consolidates candidate/listing/risk/recovery surfaces used by `/admin/review`.
- **Recovery state derivation**: `src/lib/listings/recoveryState.ts`
- **Explicit re-evaluation workflow**: `src/lib/listings/recovery.ts`
  - Keeps paused listings blocked until explicit resume and routes stale/drift refresh paths.

## 2) Supplier Trust data and logic

### Supplier quality / enrichment / availability / intelligence (canonical)
- `src/lib/suppliers/intelligence.ts`
  - Canonical supplier intelligence signal generation, policy decisions, stock class, risk flags, monitoring priority.
- `src/lib/products/supplierEnrichment.ts`
  - Supplier enrichment surface (raw supplier metadata shaping).
- `src/lib/products/supplierQuality.ts`
  - Snapshot quality and telemetry normalization surface.
- `src/lib/products/supplierAvailability.ts`
  - Availability extraction + normalization surface.

### Supplier selection / reevaluation
- **Selection scoring before listing**: `src/lib/listings/supplierSelection.ts`
- **Profit-side supplier ordering tie-breaks**: `src/lib/profit/supplierPriority.ts`
- **Active supplier reevaluation for live listings**: `src/lib/profit/activeSupplierReevaluation.ts`

### Supplier telemetry / issue evidence / scoring dependencies
- **Telemetry from audit history**: `src/lib/suppliers/telemetry.ts`
- **Evidence classification**: `src/lib/products/supplierEvidenceClassification.ts`
- **Cross-domain dependencies**: `src/lib/products/pipelinePolicy.ts`, `src/lib/profit/priceGuard.ts`, `src/lib/review/console.ts`

## 3) Listing Evolution data and logic

### AI generation / verification
- **Generation**: `src/lib/ai/generateListingPack.ts`
- **Verification/correction**: `src/lib/ai/verifyListingPack.ts`, `src/lib/ai/schemas.ts`

### Listing correction / preview prep / preview validation
- **Correction draft for live-vs-verified drift**: `src/lib/listings/computeListingCorrectionDraft.ts`
- **Preview preparation orchestration**: `src/lib/listings/prepareListingPreviews.ts`
- **Preview validation gate**: `src/lib/listings/validate_listing_preview.ts`

### Audit trail + recovery/reevaluation
- **Audit sink**: `src/lib/audit/writeAuditLog.ts`
- **Recovery/re-evaluation**: `src/lib/listings/recovery.ts`, `src/lib/listings/recoveryState.ts`

# DUPLICATION / CONFLICT RISKS

## Existing overlap risks
- Self-kill-like signals already live inside `listings.response.listingPerformance` JSON. Adding top-level columns must avoid creating contradictory sources of truth.
- Risk flags already exist across `profitable_candidates.risk_flags`, listing `response.inventoryRisk`, and review-derived flags in `src/lib/review/console.ts`; new reason-code fields must define precedence.
- Supplier confidence/reliability already exists in multiple computed surfaces (intelligence + policy + review + price guard) but not as one persisted trust score.

## Mirrored/duplicate files
- `src/db/schema.ts` is a live mirror export of `src/lib/db/schema.ts`.
- `review_files/schema.ts` also mirrors `src/lib/db/schema.ts`.
- Conclusion: only `src/lib/db/schema.ts` should be edited; re-export mirrors remain unchanged unless import contracts change.

## Legacy surfaces that should not be extended
- `drizzle/*.sql` + `drizzle/meta/*` appear legacy baseline artifacts; forward path is `migrations/*.sql` (as reinforced by `scripts/check_migration_baseline.ts`).
- Phase 1 should avoid introducing new behavior via ad-hoc scripts; keep scripts as validation/backfill only.

## Lifecycle logic that must not break
- Status transitions in `src/lib/listings/statuses.ts`.
- Pause/resume semantics in `src/lib/listings/resumePausedListing.ts`.
- Recovery fail-closed behavior in `src/lib/listings/recovery.ts` and `src/lib/listings/recoveryState.ts`.

## Risk authority that must remain authoritative
- `src/lib/risk/riskSignals.ts` action mapping and `src/lib/risk/inventoryRiskMonitor.ts` signal derivation must remain authoritative for risk actioning.
- Phase 1 self-kill scoring should remain advisory/read-only first; must not override risk AUTO_PAUSE / MANUAL_REVIEW authority.

## Backfill/recompute patterns to reuse
- Supplier refresh/recompute pathways: `src/lib/products/refreshMatchedSupplierRows.ts`, `src/lib/products/refreshSingleSupplierProduct.ts`.
- Integrity and recovery maintenance patterns: `src/lib/listings/integrity.ts`, `scripts/backfill_listing_previews_for_approved.ts`, `scripts/recheck_single_candidate.ts`.
- Schema checks and baseline checks: `scripts/check_schema_drift.ts`, `scripts/check_migration_baseline.ts`, `scripts/validate_listing_schema_alignment.mjs`.

# PROPOSED MIGRATION PLAN

## Field existence check result (requested fields)
Searched current schema + migrations for all requested fields; none were found as first-class columns.

## Canonical table placement recommendation (Phase 1 only)

### A) `listings` table additions (self-kill + listing evolution execution state)
Add nullable columns (read/write-safe, no behavior coupling in this phase):
- `performance_impressions` bigint
- `performance_clicks` bigint
- `performance_orders` bigint
- `performance_ctr` numeric(8,6)
- `performance_conversion_rate` numeric(8,6)
- `performance_last_signal_at` timestamp
- `kill_score` numeric(8,6)
- `kill_decision` text
- `kill_reason_codes` text[]
- `kill_evaluated_at` timestamp
- `auto_killed_at` timestamp
- `evolution_attempt_count` integer NOT NULL DEFAULT 0
- `last_evolution_at` timestamp
- `listing_evolution_status` text
- `listing_evolution_reason` text
- `listing_evolution_candidate_payload` jsonb
- `listing_evolution_applied_at` timestamp
- `listing_evolution_result` text

Indexes:
- `(kill_decision, kill_evaluated_at)` for operator/worker scanning.
- `(listing_evolution_status, last_evolution_at)` for queued re-evolution scans.

### B) `profitable_candidates` table additions (supplier trust support)
Add nullable columns:
- `supplier_trust_score` numeric(8,6)
- `supplier_trust_band` text
- `supplier_delivery_score` numeric(8,6)
- `supplier_stock_score` numeric(8,6)
- `supplier_price_stability_score` numeric(8,6)
- `supplier_issue_penalty` numeric(8,6)
- `supplier_trust_evaluated_at` timestamp
- `supplier_trust_reason_codes` text[]

Indexes:
- `(supplier_trust_band, supplier_trust_score desc)` for supplier selection diagnostics.
- `(supplier_trust_evaluated_at)` for staleness-driven reevaluation scheduling.

Rationale:
- `profitable_candidates` is current pre-listing decision surface and safest initial anchor for supplier trust snapshots.
- keep `products_raw` immutable snapshot semantics intact.

## Migration file strategy
- Add one additive migration in `migrations/` (forward-only SQL), e.g.:
  - `migrations/20260330_phase1_self_kill_supplier_trust_listing_evolution_schema.sql`
- Include only `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` + additive indexes.
- No destructive DDL, no default logic that changes runtime decisions.

## `src/db/schema.ts` / mirrored schema handling
- Update `src/lib/db/schema.ts` table definitions only.
- Keep `src/db/schema.ts` and `review_files/schema.ts` untouched unless export path changes (currently re-export pass-through).

## Schema validation tools to update
After migration lands, update static expectations in:
- `scripts/check_schema_drift.ts` (new expected columns/indexes).
- `scripts/validate_listing_schema_alignment.mjs` (if these new columns are declared required for ops checks).
- Optional: introduce targeted type alignment check for new enums/reason-codes in TS if current test suite relies on string unions.

# SCHEMA FILES TO EDIT FIRST
1. `migrations/<new_phase1_schema_file>.sql`
2. `src/lib/db/schema.ts`
3. `scripts/check_schema_drift.ts`
4. `scripts/validate_listing_schema_alignment.mjs` (if required strictness is desired in this phase)

# IMPLEMENTATION ORDER
Validated against current repo structure and guardrails:
1. Canonical inspection (complete in this step)
2. Schema/migration (additive, no behavior coupling)
3. Supplier Trust (read-only scoring + persistence only)
4. Self-Kill (read-only scoring + persistence only)
5. Listing Evolution (candidate payload/status persistence only)
6. Admin visibility (read-only diagnostics on control/review pages)
7. Workers/jobs (explicitly gated usage, no auto-kill before controlled enablement)
8. Scripts/tests (drift checks, unit tests, backfill/recompute safety)
9. Rollout support (feature flags, staged enablement, audit watch)

This matches your preferred order and aligns with existing control-plane + worker architecture.

# ISSUES
- DB env is missing in this runtime; live table-introspection validation could not be executed.
- There is an existing multi-source signal pattern (JSON + computed views + risk flags) that can drift without explicit precedence contracts.
- `performance_clicks` is not directly produced in current listing performance flow (views/impressions/CTR/transactions are available), so it must remain nullable until a direct click signal is introduced.

# HUB DECISION APPLIED
- Keep `supplier_trust_*` only on `profitable_candidates` for Phase 1.
- Do not denormalize supplier trust fields into `listings` yet.
- Keep `performance_clicks` nullable and do not infer it from `views`.
- Proceed with schema-first implementation in the exact additive order above.
