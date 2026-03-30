THREAD:
Whole-System Canonical Audit + US-Market Scoring / Schema / Diagnostics Correction

GOAL:
Audit the full current system after recent changes, identify outdated paths and broken diagnostics, determine required schema updates, and define the scoring/ranking corrections needed for a US-targeted marketplace strategy with stronger product-truth matching.

FILES REVIEWED:
- AGENTS.md
- package.json
- scripts/README.md
- scripts/run_autonomous_operations.ts
- scripts/report_autonomous_pipeline_state.ts
- scripts/check_ready_to_publish_rows.mjs
- scripts/verify_blocked_candidate_recovery.ts
- scripts/recover_first_listing_candidate.ts
- scripts/enqueue_listing_prepare.ts
- scripts/lib/runtimeEnv.mjs
- src/lib/autonomousOps/backbone.ts
- src/lib/autonomousOps/fullCycle.ts
- src/lib/marketplaces/trendMarketplaceScanner.ts
- src/lib/marketplaces/match.ts
- src/lib/matches/ebayMatchEngine.ts
- src/lib/profit/profitEngine.ts
- src/lib/pricing/destinationResolver.ts
- src/lib/pricing/shippingInference.ts
- src/lib/db/schema.ts
- docs/AGENT_RULES.md

FILES MODIFIED:
- docs/whole-system-canonical-audit-2026-03-30.md

FILES CREATED:
- docs/whole-system-canonical-audit-2026-03-30.md

COMMANDS RUN:
- pwd && rg --files -g 'AGENTS.md'
- cat AGENTS.md
- rg --files | head -n 200
- node -e "const keys=['DATABASE_URL','DATABASE_URL_DIRECT']; for (const k of keys) console.log(k+':'+(process.env[k]?'present':'missing'));"
- sed -n ... (all reviewed files listed above)
- rg -n ... (targeted evidence searches)

RESULT:
Project identity confirmed as QuickAIBuy (`/workspace/quickaibuy-engine`). Canonical-path audit completed for trend intake through listing readiness and autonomous orchestration. Immediate blockers are diagnostic script drift (hardcoded stale IDs + stale env assumptions), scoring fallback permissiveness, and missing first-class schema fields for shipping-origin truth and reliability-adjusted ranking.

DATA STATUS:
- DB runtime check: `DATABASE_URL` missing, `DATABASE_URL_DIRECT` missing in this execution context.
- Therefore: no live DB-backed proof was attempted; conclusions are static-code and documented-surface audit only.
- Runtime state assertions that require live DB (e.g., current candidate existence, current READY_TO_PUBLISH count) remain unverified in this environment.

SAFETY ENFORCEMENT:
- Canonical autonomous trigger is enqueue-only: `scripts/run_autonomous_operations.ts` enqueues `AUTONOMOUS_OPS_BACKBONE` and explicitly notes execution happens in canonical worker/backbone path.
- Existing listing flow remains fail-closed at publish gate and integrity layers (status- and lineage-gated, no safety weakening observed in reviewed code).
- Non-canonical direct scripts still exist and are guarded inconsistently: some scripts use canonical runtime env loaders; others still use ad-hoc `.env.local` loading.

FAILURE VISIBILITY:
- Backbone and full-cycle produce structured stage outputs with `status`, `reasonCode`, counts, and audit log events.
- Diagnostic script drift reduces failure visibility for operators because stale defaults can report `{ ok: true, candidates: [] }` without clearly identifying stale ID assumptions.
- `ops:autonomous` output confirms enqueue action, not work completion; operational truth must come from worker/audit/DB state surfaces.

PERFORMANCE IMPACT:
- No runtime code changed.
- Proposed scoring/policy/schema changes will add moderate read cost but should remain bounded if implemented with selective materialized fields and targeted indexes.

BEHAVIOR CHANGE AUDIT:
1) operator-surface truth bugs
- Risk: treating `ops:autonomous` enqueue success as completion signal.
- Correct truth surface: audit events + worker progression + listing/candidate DB truth.

2) diagnostic-tooling bugs
- `verify_blocked_candidate_recovery.ts` defaults to two hardcoded UUIDs and queries `profitable_candidates` by those IDs (`pc.id = ANY($1::uuid[])`). If records are gone/rotated/recomputed, script still returns `ok: true` with empty `candidates`.
- Script assumptions are also tightly coupled to current `estimated_fees.selectedSupplierOption` JSON shape; schema/evidence drift can silently flatten diagnostic value.
- `scripts/README.md` still describes these defaults as "known blocked IDs", which can become stale rapidly.
- `recover_first_listing_candidate.ts` and some older helpers still load `.env.local` directly, conflicting with canonical runtime targeting guidance.

3) scoring/ranking quality issues
- `trendMarketplaceScanner` accepts low-quality fallback via `MARKETPLACE_ALLOW_TOP_RESULT_FALLBACK=true` default, allowing best-seen item even below min score.
- Query generation in `match.ts` is token/lexical-heavy and can produce broad ambiguous strings (e.g., noun/modifier mixes) that over-index on query syntax rather than product truth.
- `compareCandidates` prioritizes `productTruthScore` and `finalMatchScore`, but fallback path bypasses minimum-score gate after query loop.
- `ebayMatchEngine` remains primarily lexical/fuzzy/token driven with limited variant disambiguation and no explicit US-origin preference.

4) schema shortcomings
- Core shipping-origin, origin confidence/source, transparency state, supplier reliability, and diagnostic lineage remain mostly nested under JSON (`estimated_fees`) rather than first-class indexed columns.
- This weakens canonical analytics, deterministic ranking, and robust diagnostics contracts.

PART 1 — CANONICAL SYSTEM AUDIT (END-TO-END)
- Trend intake / supplier ingestion: canonical flows exist in autonomous/full-cycle orchestration and supplier refresh paths.
- Marketplace scan: canonical scanner present but still permits low-score fallback.
- Matching: pipeline includes confidence/policy checks but still largely lexical; weak product-form/variant rejection remains possible.
- Profitability: strong safety gates exist (pipeline policy, hard-gate, shipping/availability guards), but ranking preferences do not yet strongly encode US-first origin preference.
- Review/listings readiness: status model and gate checks are centralized; shipping-origin truth still a blocker and sometimes inferred from nested JSON.
- Autonomous backbone: canonical stage orchestration and audit logging are present; enqueue vs completion semantics must stay explicit.
- Diagnostics/verifiers: mixed quality; some scripts are canonical and read-only, others contain stale assumptions and env-loading drift.

Outdated/duplicated/stale surfaces to prioritize:
- Hardcoded default candidate IDs in `verify_blocked_candidate_recovery.ts`.
- Legacy `.env.local` direct loaders in `recover_first_listing_candidate.ts` and `enqueue_listing_prepare.ts`.
- Documentation implying stability of non-deterministic default candidate IDs.

PART 2 — DIAGNOSTIC TOOLING AUDIT
Why verifier returns no candidate rows for default IDs:
- Most probable primary cause: stale default IDs no longer present in `profitable_candidates` due to recompute/churn.
- Query surface itself is still `profitable_candidates` (`WHERE pc.id = ANY($1::uuid[])`), so a changed source table is unlikely the first-order issue for this specific empty-result symptom.
- Secondary cause candidates:
  - candidate UUIDs were replaced by newer profitable candidate rows for same supplier/listing pairs.
  - records were removed or superseded by maintenance/migration cycles.
  - operator expects listing-level truth while script keys on candidate IDs only.
- The script returning `{ ok: true }` with empty `candidates` is technically valid SQL result but operationally ambiguous without stale-ID diagnosis.

Diagnostic robustness plan (no migration yet):
1. Replace hardcoded default IDs with dynamic seed query:
   - most-recent blocked/manual-review candidates with shipping-related block reasons.
2. Add dual lookup modes:
   - by candidate ID
   - by (`supplier_key`, `supplier_product_id`, `marketplace_listing_id`) keyset.
3. Emit explicit diagnostics classification:
   - `NO_SUCH_CANDIDATE_IDS`
   - `CANDIDATE_SUPERSEDED`
   - `LISTING_EXISTS_BUT_CANDIDATE_MISSING`
4. Add contract tests with fixture DB snapshots for verifier outputs.
5. Standardize env loading to canonical runtime loader in all diagnostics.

PART 3 — SCORING / MATCHING AUDIT
Current quality gaps:
- Lexical/query overreach allows unrelated candidates to survive query stage.
- Fallback can select below-threshold results when no candidate passes min score.
- Weak product-form/variant exclusion in marketplace scan layer (some checks exist deeper but late).
- Noisy candidate clusters are not strongly collapsed by product identity attributes (form factor, compatibility, brand exclusion, variant constraints).
- Market-depth signal exists in profit layer, but earlier matching/ranking does not fully exploit it to suppress noisy thin-market listings.

Required scoring corrections:
1. Remove permissive fallback as default (disable unless explicitly debug-enabled).
2. Introduce hard product-form mismatch penalties before acceptance.
3. Add variant/brand contradiction checks (capacity, size, pack-count, model family) at scan score stage.
4. Add cluster-level dedupe/rerank by normalized product identity vector.
5. Require stronger semantic + attribute agreement for final candidate acceptance.
6. Feed market-depth confidence back into match acceptance, not only profit ranking.

PART 4 — US-MARKET PRIORITY POLICY (DEFINE ONLY)
Policy definition:
- Canonical destination context for this strategy: US.
- Strong rank preference: `ship_from_country == US`.
- Non-US origins remain eligible only when economics/fit significantly dominates and transparency is explicit.
- Unresolved origin => fail-closed for listing readiness.
- When opportunities are near-equivalent, prefer supplier option with US-origin and higher reliability-adjusted profit.

Code placement (no implementation yet):
- `src/lib/pricing/destinationResolver.ts`: ensure destination context is explicitly US in US-target mode.
- `src/lib/profit/profitEngine.ts` (`chooseBestSupplierOption` ordering): add explicit US-origin preference tier before cost tie-breakers.
- `src/lib/listings/prepareListingPreviews.ts` + readiness gate paths: enforce unresolved-origin fail-close and clear reason codes.
- `src/lib/marketplaces/trendMarketplaceScanner.ts`: incorporate US-market-aware penalties in candidate ranking when destination is US.

PART 5 — SCHEMA AUDIT (RECOMMENDATIONS ONLY)
Promote to first-class columns (recommended):
1. `profitable_candidates`
- `ship_from_country` text
- `origin_source` text
- `origin_confidence` numeric(5,4)
- `shipping_transparency_state` text
- `supplier_reliability_score` numeric(6,4)
- `selected_supplier_rationale` text
- `opportunity_type` text
- `reliability_adjusted_profit_usd` numeric(12,2)
- `ai_validation_state` text
- `diagnostic_lineage_state` text
- `recovery_state` text

2. `listings`
- `ship_from_country` text (frozen publish payload truth)
- `origin_confidence` numeric(5,4)
- `shipping_transparency_state` text

Keep as JSON evidence (for traceability, not primary ranking):
- raw supplier payload snippets
- full AI rationale detail blobs
- raw shipping estimates arrays

Index recommendations (future migration):
- `(marketplace_key, decision_status, ship_from_country)`
- `(shipping_transparency_state, origin_confidence)`
- `(opportunity_type, reliability_adjusted_profit_usd DESC)`
- partial index for `listing_eligible=true AND ship_from_country='US'`

PART 6 — AGENTS.MD / CODEX INSTRUCTIONS AUDIT
Exact replacement text proposal:

"""
# Codex Defaults

- This repo’s Codex environment may be preloaded from saved production settings for `mmaani/quickaibuy-engine`, but runtime DB variables are not guaranteed in every execution context.
- Before any DB-backed analysis, diagnostics, or production-impacting action, explicitly verify all of the following:
  - `DATABASE_URL` or `DATABASE_URL_DIRECT` is present
  - runtime DB target classification (`pnpm db:status` / runtime diagnostics)
  - the task is executing in a DB-enabled runtime
- If DB env is missing, fail explicitly and report: "DB-enabled runtime required for this task." Do not assume localhost. Do not fabricate live-data conclusions.
- Keep `ENABLE_EBAY_LIVE_PUBLISH=false` unless the user explicitly requests a guarded live publish operation.
- Canonical runtime truth must come from control plane, jobs worker, backbone, and audit/logged DB truth — not historical UI assumptions.
- `ops:autonomous` enqueue success is not completion proof; completion must be read from worker/audit/DB outcomes.
- Preserve fail-closed behavior and safety gates; do not bypass guardrails in scripts or diagnostics.
- Prefer deterministic, auditable changes with explicit reason codes.
- AI usage must remain bounded, cached where possible, explainable, and non-authoritative.
"""

PART 7 — WHOLE-SYSTEM TEST STRATEGY
Recommended regression stack:
1. Static checks
- `pnpm lint`
- `pnpm test`
- typecheck command (add explicit `pnpm typecheck` script if absent)

2. Runtime/env guard checks
- `pnpm runtime:diag`
- `pnpm db:status`
- fail-fast gate for DB-missing contexts in DB-backed diagnostics

3. Canonical pipeline smoke
- enqueue + worker-backed autonomous diagnostics phase
- verify stage status/audit events, not only enqueue receipts

4. Admin truth checks
- compare `/admin/review` and `/admin/listings` counts against canonical DB aggregates
- contract check for READY_TO_PUBLISH/ACTIVE consistency and lineage integrity

5. Scoring regression corpus
- maintain labeled query/product set for known failure phrases and near-miss variants
- assert rejection of irrelevant lexical matches and enforce minimum semantic/truth thresholds

6. Supplier evidence regression set
- enforce origin extraction/transparency invariants across suppliers
- assert unresolved-origin remains fail-closed

7. Diagnostic contract tests
- stable JSON contract tests for verifier scripts
- fixtures for stale IDs, superseded candidates, and missing lineage cases

PRIORITIZED IMPLEMENTATION PLAN
1) immediate blockers
- Fix diagnostic stale-ID defaults and ambiguous empty-result reporting.
- Standardize diagnostics env loading to canonical runtime env utilities.
- Add explicit operator-facing note: enqueue != completion.

2) scoring/ranking issues
- Disable permissive low-score fallback by default.
- Add hard product-truth mismatch penalties and cluster dedupe.
- Encode US-origin preference earlier in selection.

3) schema updates
- Introduce first-class origin/reliability/diagnostic lineage columns.
- Index for US-target readiness and reliability-adjusted ranking.

4) diagnostic/tooling fixes
- Add dual lookup key modes and classification codes.
- Add verifier contract tests.

5) instruction/documentation fixes
- Update AGENTS defaults with explicit DB/runtime verification and enqueue/completion semantics.
- Keep canonical command boundaries and non-canonical warning posture.

OPEN RISKS:
- Without DB-enabled runtime, live-data claims (current candidate existence, status churn, READY_TO_PUBLISH state) remain unverified.
- Migration sequencing risk: schema-first changes must preserve backward compatibility for existing JSON readers.
- Tightening fallback/match acceptance may reduce throughput initially; requires monitored rollout.

NEXT ACTION:
1. Implement diagnostic script hardening first (read-only + contract tests).
2. Implement scoring fallback tightening behind explicit feature flags.
3. Draft migration files for new first-class columns and indexes (do not execute yet).
4. Add US-target policy hooks in profit/listing gating with fail-closed unresolved origin.

QUESTION TO HUB:
Approve this order for implementation:
(1) diagnostics hardening,
(2) scoring fallback/product-truth corrections,
(3) schema migrations for origin/reliability lineage,
(4) US-priority ranking policy rollout with guarded feature flags?
