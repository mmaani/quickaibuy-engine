THREAD:
Data Quality + Supplier Intelligence + Learning Signal Strength Program

GOAL:
Improve data quality, supplier reliability, and learning signal integrity to eliminate LEARNING_HUB_CRITICAL_DRIFT and enable stable autonomous decision-making.

FILES MODIFIED:
- docs/data-quality-supplier-intelligence-learning-signal-audit-2026-03-30.md

FILES CREATED:
- docs/data-quality-supplier-intelligence-learning-signal-audit-2026-03-30.md

COMMANDS RUN:
- rg --files -g 'AGENTS.md'
- cat AGENTS.md
- rg -n "standard system report template|THREAD:|GOAL:|FILES MODIFIED:" -S .
- sed -n '1,220p' docs/order-automation-validation.md
- rg -n "products_raw|marketplace_prices|matches|profitable_candidates|trend_candidates|LEARNING_HUB_CRITICAL_DRIFT|learning_hub" scripts src docs -S
- node scripts/monitor_pipeline.mjs
- node scripts/check_runtime_db_fingerprint.mjs
- pnpm exec tsx scripts/report_autonomous_pipeline_state.ts
- sed -n '520,700p' src/lib/autonomousOps/backbone.ts
- sed -n '1,260p' src/lib/db/schema.ts
- sed -n '320,430p' src/lib/db/schema.ts
- rg -n "getLearningHubScorecard|openDrift|critical|autonomyPauseReasons|freshness" src/lib/learningHub src/lib/control -S
- sed -n '1,260p' src/lib/learningHub/scorecard.ts
- sed -n '1,280p' src/lib/learningHub/freshness.ts
- sed -n '1,220p' src/lib/learningHub/drift.ts
- sed -n '1,320p' src/lib/control/getMatchQualitySummary.ts
- sed -n '1,320p' src/lib/suppliers/intelligence.ts
- sed -n '1,220p' src/lib/learningHub/pipelineWriters.ts
- sed -n '840,1020p' src/lib/learningHub/productMarketIntelligence.ts

RESULT:
System-level diagnosis completed with code-level root-cause traceability.

Pre-flight and governance confirmation:
- Current repository identified as QuickAIBuy (`/workspace/quickaibuy-engine`).
- Task domain (marketplace automation, supplier crawlers, matching, learning hub) matches QuickAIBuy scope.
- No cross-project artifacts (Zomorod/NIVRAN) were introduced.
- No secrets were read or printed.

Runtime evidence status:
- Live DB audit is blocked in this environment.
- `scripts/check_runtime_db_fingerprint.mjs` reports `CONFIG_MISSING` due to absent `DATABASE_URL`/`DATABASE_URL_DIRECT`.
- `scripts/report_autonomous_pipeline_state.ts` fails for the same reason.
- Therefore, frequency metrics are classified as `UNVERIFIED_RUNTIME` and all numeric rates below are presented as required measurement definitions, not observed production values.

----------------------------------------
PART 1 — DATA QUALITY AUDIT
----------------------------------------

Scope: `products_raw`, `marketplace_prices`, `matches`, `profitable_candidates`, `trend_candidates`.

1) products_raw
- Missing fields risk:
  - Core descriptive fields (`title`, `images`, `currency`, `price_min`, `price_max`, `availability_status`, `shipping_estimates`) are nullable while `raw_payload` is required.
  - This enables structurally valid but weak rows where only `raw_payload` exists.
- Inconsistent values risk:
  - Supplier key normalization is not enforced at table level; mixed casing/synonyms can persist.
- Stale data frequency:
  - Must be measured via `snapshot_ts` age buckets (24h/48h/72h). Runtime unavailable.
- Invalid/weak records:
  - Rows with empty/low-signal titles, missing shipping estimates, or availability unknown degrade downstream confidence.
- Duplication issues:
  - No uniqueness index on (`supplier_key`, `supplier_product_id`, `snapshot_ts`) or latest-row guarantee; duplicate snapshots are possible by design.

2) marketplace_prices
- Missing fields risk:
  - `product_raw_id`, `supplier_key`, and `supplier_product_id` are nullable; this permits detached marketplace snapshots.
- Inconsistent values risk:
  - Listing metadata quality varies by scan payload; `matched_title`, `final_match_score`, `availability_status` can be sparse.
- Stale data frequency:
  - Must be measured with `snapshot_ts` and marketplace freshness windows; runtime unavailable.
- Invalid/weak records:
  - Records with low or null score fields can still persist if payload exists.
- Duplication issues:
  - Index on (`marketplace_key`, `marketplace_listing_id`) exists but is not unique, so repeated listing snapshots are expected.

3) matches
- Missing fields risk:
  - `evidence` is nullable; this allows active links without full explainability context.
- Inconsistent values risk:
  - `supplier_key` canonicalization inconsistencies are explicitly diagnosed by control queries.
- Stale data frequency:
  - Must be measured from `last_seen_ts` windows. Runtime unavailable.
- Invalid/weak records:
  - Built-in diagnostics classify weak matches using low token overlap, fuzzy similarity, and marketplace score.
- Duplication issues:
  - No uniqueness constraint on pair keys (`supplier_key`, `supplier_product_id`, `marketplace_key`, `marketplace_listing_id`), and duplicate detection is explicitly present.

4) profitable_candidates
- Missing fields risk:
  - Multiple economics fields are nullable (`estimated_profit`, `margin_pct`, `roi_pct`, etc.), allowing partially computed candidates.
- Inconsistent values risk:
  - Decision-state transitions rely on upstream data freshness and block reasons; incomplete lineage creates integrity pressure.
- Stale data frequency:
  - Must be measured using `calc_ts` age and referenced snapshot age. Runtime unavailable.
- Invalid/weak records:
  - Candidates can exist while listing-ineligible with unresolved block reasons (expected fail-closed behavior).
- Duplication issues:
  - No explicit uniqueness for candidate identity tuple; dedupe is operational, not schema-enforced.

5) trend_candidates
- Missing fields risk:
  - `meta` is optional; candidate context can be insufficient.
- Inconsistent values risk:
  - Open text `candidate_value` normalization quality depends on upstream derivation.
- Stale data frequency:
  - Must be measured with `created_ts` and status aging. Runtime unavailable.
- Invalid/weak records:
  - Low-signal trend rows can propagate if not filtered by quality.
- Duplication issues:
  - No uniqueness constraint visible in schema for (`trend_signal_id`, `candidate_type`, `candidate_value`).

----------------------------------------
PART 2 — SUPPLIER QUALITY ANALYSIS
----------------------------------------

Suppliers explicitly modeled in intelligence policy: `cjdropshipping`, `temu`, `alibaba`, `aliexpress`.

Assessment basis:
- Base priority, wave budgets, reliability thresholds, and evidence strength formulas.
- API stability penalties (challenge/fallback/429/low-quality signals).

Per-supplier diagnosis (policy-level):

1) CJ Dropshipping
- Data completeness: highest base priority and relaxed minimum reliability gate.
- Pricing reliability: treated as highest baseline reliability.
- Stock accuracy: does not require strongest stock evidence by policy, but receives highest default trust.
- Shipping clarity: no strict strong-shipping requirement in wave budget.
- Image quality + title/description quality: inferred from higher baseline and parser yield assumptions, not explicitly hard-gated at supplier policy layer.
- Risk class: LOW–MEDIUM baseline; elevated if telemetry emits challenge/fallback/429.

2) Temu
- Data completeness: high but below CJ.
- Pricing reliability: medium-high.
- Stock accuracy and shipping clarity: moderate requirements.
- Risk class: MEDIUM baseline.

3) Alibaba
- Data completeness: moderate.
- Pricing reliability: moderate.
- Shipping clarity: explicitly stricter (`requireStrongShippingEvidence=true`).
- Risk class: MEDIUM–HIGH for shipping-sensitive candidates.

4) AliExpress
- Data completeness: lowest baseline priority.
- Pricing reliability: treated conservatively.
- Stock accuracy + shipping clarity: strict requirements for both strong stock and strong shipping evidence.
- Additional penalty:
  - `shouldDeprioritize` triggers when stock/shipping/API stability are below thresholds and then reliability is downscaled.
- Risk class: HIGH-RISK by default policy unless evidence quality is strong.

Detected classes:
- Weak suppliers: any supplier with low stock/shipping evidence and/or frequent telemetry penalties.
- Inconsistent suppliers: suppliers with volatile refresh success rates and mixed canonical keys.
- High-risk suppliers: especially AliExpress segments failing evidence thresholds.

----------------------------------------
PART 3 — MATCH QUALITY DIAGNOSTICS
----------------------------------------

Diagnostics implemented:
- Confidence distribution buckets:
  - rejected below exception minimum
  - manual review band
  - active above preferred minimum
- False positives/weak links heuristics:
  - token overlap < 2
  - recomputed title similarity < 0.80
  - marketplace score < 0.50
  - borderline fuzzy keyword matches
- Duplication:
  - duplicate pair detection query for same supplier/product + marketplace/listing tuple.
- Supplier-key consistency:
  - blank keys, non-canonical casing, and cross-table key-variant groups.

Current runtime status:
- Distribution and counts are `UNVERIFIED_RUNTIME` (DB unavailable).

High-probability failure patterns (from implemented checks):
- Weak token overlap causing low semantic confidence.
- Duplicate match pairs inflating apparent match coverage.
- Non-canonical supplier keys increasing false group joins.
- Price-context mismatch risk when marketplace scoring is weak.
- Brand mismatch risk is partially covered through weak fuzzy/link heuristics but should be made explicit in evidence policy.

----------------------------------------
PART 4 — LEARNING HUB SIGNAL ANALYSIS
----------------------------------------

Signal freshness:
- Multi-domain freshness policies enforce warning/error windows.
- Domains with `autonomyImpact='pause'` generate `STALE_*` pause reasons when stale.

Drift frequency:
- Drift severity thresholds:
  - warning at delta ratio >= 0.20
  - critical at delta ratio >= 0.35
- Open critical drift count is read from `learning_drift_events` over 14-day window.

Missing feedback loops:
- Pipeline writers enqueue continuous refresh in best-effort mode.
- If enqueue/refresh fails silently under load, evidence can age without hard failure propagation.

Incorrect learning writes:
- Evidence writes default to PASS while relying on blocked reasons and confidence quality.
- If blocked reasons are underreported, learning quality can be optimistic.

Signal imbalance:
- Supplier and evidence-derived metrics are aggregated, but imbalance can occur when one signal family (e.g., stale freshness or weak shipping evidence) dominates autonomy pause logic.

----------------------------------------
PART 5 — ROOT CAUSE OF CRITICAL DRIFT
----------------------------------------

Why `LEARNING_HUB_CRITICAL_DRIFT` is triggered:
- Autonomous backbone pauses listing preparation and guarded publish when `learningHub.openDrift.critical > 0`.
- Additional freshness-generated `STALE_*` pause reasons can also pause recompute/prepare/publish stages.

Most likely pipeline stage causing trigger:
- Learning metric/drift recording and freshness refresh cadence in Learning Hub.
- Upstream data quality defects (supplier snapshot quality, marketplace freshness, weak matches) raise drift pressure and can materialize critical drift events.

Classification:
- Primary: learning logic + freshness/data recency issue.
- Secondary contributors: supplier evidence quality and match quality instability.
- Not an execution architecture fault; the pause behavior is intentional fail-closed enforcement.

----------------------------------------
PART 6 — IMPROVEMENT PLAN
----------------------------------------

Priority 0 (immediate, no architecture changes)
1) Data validation hardening (write-time quality floors)
- Enforce canonical supplier key at write boundaries for `products_raw`, `matches`, `profitable_candidates`.
- Add strict weak-record tagging for missing shipping/availability/title evidence (without dropping safety-critical rows).
- Add explicit stale-age counters per table in monitoring output (24h/48h/72h buckets).

2) Supplier filtering rules
- Operationalize reliability cutoffs from supplier intelligence into candidate admission gates.
- Keep AliExpress strict evidence requirements and add explicit block reason taxonomy for low-quality image/title payloads.

3) Match quality upgrades
- Block ACTIVE promotion when weak-match heuristics are present unless manual override reason exists.
- Add explicit brand-token mismatch heuristic into evidence map and weak-match reasons.
- Add canonical key enforcement before duplicate-pair checks to reduce false duplicates.

4) Learning signal corrections
- Convert best-effort refresh enqueue failures into measurable counters and alertable health signals.
- Add “write rejected due to incomplete blocked reasons” guard for suspiciously high PASS with low evidence quality.
- Track drift event reopen rate and unresolved critical drift age SLA.

Priority 1 (short horizon)
5) Freshness + drift observability
- Add one report job that emits:
  - stale domain list
  - open critical drift count by category
  - top failing evidence signatures
  - supplier reliability decay trend (24h vs 7d).

6) Dataset hygiene controls
- Add non-destructive dedupe monitors:
  - matches duplicate tuple monitor
  - trend candidate normalized-value collision monitor
  - profitable candidate lineage completeness monitor.

Priority 2 (stability reinforcement)
7) Learning/decision integrity
- Add segment-level drift guardrails for supplier-specific high-volume segments.
- Introduce freshness-aware weighting so stale domains cannot dominate opportunity scoring.

Execution notes:
- No execution architecture changes required.
- No enforcement weakening required.
- Focus remains data correctness and signal quality integrity.

SECURITY FINDINGS:
- No secret values accessed or printed.
- No secret files were introduced.
- No runtime artifacts were committed.

NEXT ACTION:
1) Provide runtime DB access (`DATABASE_URL`/`DATABASE_URL_DIRECT`) in this environment.
2) Run a production-like audit SQL pack for the five core datasets to convert all `UNVERIFIED_RUNTIME` findings into measured rates.
3) Implement Priority 0 checks as minimal, localized data-quality guardrails.
4) Re-run Learning Hub scorecard and verify `openDrift.critical == 0` before autonomous stage unpause.
