THREAD:
Match Quality + Supplier Signal Recovery Program (CRITICAL)

GOAL:
Eliminate low-quality matches, improve supplier signal strength, and increase high-confidence matches to enable valid publishable candidates.

FILES MODIFIED:
- docs/match-quality-supplier-signal-recovery-critical-2026-03-30.md

FILES CREATED:
- docs/match-quality-supplier-signal-recovery-critical-2026-03-30.md

COMMANDS RUN:
- rg --files -g 'AGENTS.md'
- cat AGENTS.md
- rg -n "154|24 cases|LOW confidence|HIGH confidence|LISTING_READY_BLOCKED_PUBLISH_PAYLOAD|BLOCKED_PUBLISH_PAYLOAD|low confidence matches|high confidence" docs scripts src -S
- sed -n '1,320p' src/lib/matches/ebayMatchEngine.ts
- sed -n '320,620p' src/lib/matches/ebayMatchEngine.ts
- sed -n '1,320p' src/lib/control/getMatchQualitySummary.ts
- sed -n '1,320p' src/lib/suppliers/intelligence.ts
- sed -n '1,220p' src/lib/products/pipelinePolicy.ts
- sed -n '680,760p' src/lib/marketplaces/ebayPublish.ts
- sed -n '300,450p' src/lib/listings/markListingReadyToPublish.ts
- rg -n "LISTING_READY_BLOCKED_PUBLISH_PAYLOAD|LISTING_PUBLISH_PAYLOAD_GATE_FAILED|publish payload gate" src scripts docs -S
- node scripts/check_runtime_db_fingerprint.mjs

RESULT:
System-level diagnosis completed for matching + supplier signal quality, with direct traceability to current matching/publish gates.

Pre-flight and project isolation checks:
- Repository confirmed as QuickAIBuy (`/workspace/quickaibuy-engine`).
- Thread scope (matches, supplier signals, listing blocks) belongs to QuickAIBuy pipeline domain.
- No cross-project instructions/artifacts (Zomorod/NIVRAN) used.
- No secrets accessed or printed.

Runtime evidence status:
- Live cohort computation is blocked: `DATABASE_URL`/`DATABASE_URL_DIRECT` not set in this environment.
- `node scripts/check_runtime_db_fingerprint.mjs` returned `CONFIG_MISSING`.
- Requested cohort sizes are treated as task-provided constants for analysis:
  - LOW confidence cohort: 154
  - HIGH confidence cohort: 24

Analysis method (strictly within current architecture):
- Used current match scoring + routing logic (`runEbayMatches` + `evaluateMatchQuality`).
- Used current control-plane weak-match diagnostics (`getMatchQualitySummary`).
- Used current supplier intelligence scoring and wave budgets.
- Used current publish payload fail-closed gate used by `LISTING_READY_BLOCKED_PUBLISH_PAYLOAD`.

----------------------------------------
PART 1 — LOW MATCH ROOT CAUSE ANALYSIS (154)
----------------------------------------

Cohort definition used:
- LOW = `confidence < PRODUCT_PIPELINE_MATCH_EXCEPTION_MIN (0.70)`.

Scoring dimensions and low-match failure patterns:

1) Token overlap quality
- Engine computes token overlap ratio and flags `LOW_TOKEN_OVERLAP` when `< 0.45`.
- Low overlap also receives an extra confidence penalty (`-0.04` per overlap/fuzzy weakness), amplifying rejection probability.
- Pattern: short/noisy titles or heavily transformed marketplace wording produce poor shared token sets.

2) Title similarity
- Two parallel signals:
  - lexical (Jaccard)
  - fuzzy (bigram Dice)
- `WEAK_FUZZY_SIMILARITY` flag triggers when fuzzy similarity `< 0.58`.
- Pattern: low-quality supplier title normalization, truncated marketplace title, or noisy attribute suffixes.

3) Price difference %
- Price alignment is ratio-based (`marketplacePrice / supplierPrice`), optimized for profitable spread ranges.
- Full score only when ratio is in a tight profitable band; weak score outside preferred band.
- Pattern in low cohort: ratio near 1.0 or outside practical resale band reduces confidence contribution and pushes borderline matches below threshold.

4) Image similarity (if available)
- Current matching score does not include direct image-similarity embedding.
- Image availability indirectly affects downstream policy quality, but low-match confidence is currently text/price/market-score dominated.
- Pattern: image quality gaps are under-represented at matching stage, causing some false positives/false negatives to pass text-first checks.

5) Brand mismatch
- Current explicit brand penalty only catches: generic supplier title + branded marketplace title (`BRANDED_MARKETPLACE_GENERIC_SUPPLIER`).
- Pattern: brand mismatch not fully modeled when both sides contain brand-like tokens but disagree semantically.

6) Category mismatch
- Category proxy uses inferred product type from title (lighting/organizer/fan/electronics/auto/general).
- `PRODUCT_TYPE_MISMATCH` penalizes cross-type title pairs.
- Pattern: category ambiguity in generic titles collapses to `general`, reducing discrimination and creating weak confidence gradients.

Primary failing fields in low cohort (by implemented logic):
- `evidence.overlap` low.
- `evidence.recomputedTitleSimilarity` low.
- `evidence.marketplaceScore` weak.
- Marketplace/supplier titles lacking coherent shared attributes.
- Price alignment outside profitable-resale preference window.

----------------------------------------
PART 2 — HIGH MATCH SUCCESS PATTERN (24)
----------------------------------------

Cohort definition used:
- HIGH = `confidence >= PRODUCT_PIPELINE_MATCH_PREFERRED_MIN (0.80)` and routed `ACTIVE`.

Observed success structure from scoring/routing policy:

1) Title structure
- High lexical + fuzzy similarity with clear descriptive tokens.
- Strong token overlap and good attribute-token intersection.
- Minimal noise words after stopword removal.

2) Supplier quality
- Better supplier raw payload quality helps attribute extraction and overlap quality.
- Canonical supplier keys and consistent metadata improve repeat match stability.

3) Price alignment
- Marketplace/supplier ratio sits in preferred monetization range, yielding strong `priceAlignment` score.

4) Product type
- Supplier and marketplace title type inference agrees (same inferred type), avoiding `PRODUCT_TYPE_MISMATCH` penalty.

High-cohort common signature (expected):
- overlap >= 0.45
- fuzzySimilarity >= 0.58
- marketplaceScore >= 0.50
- productTypeAlignment = 1
- no branded-generic penalty
- price ratio in preferred band

----------------------------------------
PART 3 — SUPPLIER QUALITY SEGMENTATION
----------------------------------------

Segmentation dimensions:
- match success rate (high/low confidence share)
- data completeness (title + attributes + shipping/availability clarity)
- price stability (alignment consistency over refreshes)
- image quality signal presence

Policy-grounded segmentation:

A) Strong suppliers (keep/promote)
- `cjdropshipping` (highest base priority, broad budget allowance).
- `temu` (strong secondary priority with moderate gate strictness).

B) Medium suppliers (conditional promote)
- `alibaba` (usable but requires stronger shipping evidence).

C) Weak/high-risk suppliers (penalize/filter early)
- `aliexpress` (strict stock/shipping/API thresholds and explicit deprioritization logic).

Operational supplier risk rules (from current logic):
- Penalize suppliers with low stock evidence + low shipping evidence + weak API stability.
- Prioritize suppliers with high refresh success rate and stable canonical keys.

----------------------------------------
PART 4 — MATCHING ALGORITHM WEAKNESS
----------------------------------------

1) Token weighting weakness
- Confidence blend heavily depends on lexical/fuzzy/token/marketplace score, but no adaptive weighting per category/supplier reliability.
- Low-quality text can dominate outcome even when structured attributes are strong.

2) Brand detection weakness
- Brand mismatch handling is narrow (generic-vs-branded heuristic only).
- No robust explicit “brand contradiction” penalty when both sides contain conflicting brand tokens.

3) Price tolerance weakness
- Ratio buckets are coarse; edge bands can produce abrupt confidence drops.
- No confidence shaping by supplier category economics volatility.

4) False positives
- Can occur when fuzzy similarity appears acceptable but brand/category semantics diverge.
- Also possible when marketplace score is moderate yet attribute overlap is weak.

5) False negatives
- Can occur for valid variants when titles are sparse/noisy and token overlap underperforms.
- Missing image-similarity signal in matching stage reduces rescue path for true matches with poor text.

----------------------------------------
PART 5 — BLOCKING CONDITIONS ANALYSIS
----------------------------------------

Target event:
- `LISTING_READY_BLOCKED_PUBLISH_PAYLOAD`.

Why candidates are blocked in this gate:

1) Missing fields
- Missing normalized `shipFromCountry` (explicit fail-closed payload requirement).
- Missing shipping transparency block (handling/shipping timing clarity absent).

2) Weak images
- Image readiness is validated before payload gate and can block progression separately.
- Not directly encoded as this payload event reason, but still part of listing-ready chain.

3) Bad price
- Price/margin safety is enforced in subsequent price-guard gate (`PRICE_GUARD_*` reasons), not this payload event.

4) Inconsistent data
- Payload inconsistency between supplier-origin fields and publishable structure causes payload requirement failure.

Blocking summary:
- `LISTING_READY_BLOCKED_PUBLISH_PAYLOAD` is primarily a structural completeness/transparency failure, not a pricing or match-threshold failure.

----------------------------------------
PART 6 — IMPROVEMENT PLAN (PRIORITIZED)
----------------------------------------

Priority 0 — immediate quality recovery

1) Stricter match rules (without architecture changes)
- Raise effective weak-match suppression for ACTIVE routing:
  - enforce minimum token overlap floor for ACTIVE candidates
  - enforce minimum fuzzy similarity floor for ACTIVE candidates
- Add explicit brand consistency check:
  - block ACTIVE when detected supplier-brand and marketplace-brand conflict
- Add tighter price deviation guard for ACTIVE routing:
  - explicit ratio thresholds by supplier segment quality tier.

2) Supplier filtering
- Reject weak suppliers earlier in candidate flow when:
  - stock evidence strength below threshold
  - shipping evidence strength below threshold
  - API stability degraded or repeated telemetry penalties
- Promote strong suppliers by allocating higher effective candidate budget to strong segments.

3) Data cleaning
- Normalize supplier + marketplace titles before scoring with stricter token sanitation.
- Remove noisy boilerplate token fragments and repeated promo phrases.
- Enforce canonical supplier key normalization before persistence to reduce duplicate/inconsistent match groups.

Priority 1 — control-plane quality verification
- Add explicit low/high cohort daily metrics panel:
  - low confidence count
  - high confidence count
  - top weak-match reasons
  - supplier-level success/failure ratio.
- Add payload-block reason breakdown for `LISTING_READY_BLOCKED_PUBLISH_PAYLOAD` by root field (ship-from vs shipping transparency).

Priority 2 — stabilization
- Add targeted manual-review queue ordering by:
  - near-threshold confidence
  - strong supplier reliability
  - high attribute overlap but weak lexical signal (likely salvageable true matches).

SQL pack to run when DB is available (for exact cohort evidence):
1) LOW cohort (expected 154):
- `select * from matches where confidence::numeric < 0.70 order by last_seen_ts desc;`
2) HIGH cohort (expected 24):
- `select * from matches where confidence::numeric >= 0.80 and upper(coalesce(status,''))='ACTIVE' order by last_seen_ts desc;`
3) Weak reason distribution:
- Use `src/lib/control/getMatchQualitySummary.ts` weak reason CTE logic directly for production counts.
4) Supplier segmentation:
- Group matches by normalized supplier key and compute high/low ratio.
5) Publish payload block diagnostics:
- Audit `order_events` / audit log rows for event type `LISTING_READY_BLOCKED_PUBLISH_PAYLOAD` and aggregate `errors[]`.

SECURITY FINDINGS:
- No secrets were exposed.
- No `.env` files were added or modified.
- No runtime artifacts were committed.

NEXT ACTION:
1) Provide runtime DB URL in execution environment and run the SQL pack above to replace inferred patterns with measured production evidence.
2) Implement Priority 0 safeguards as minimal scoring/gating refinements in existing match and supplier-quality logic.
3) Recompute matches and validate that LOW cohort declines while HIGH ACTIVE cohort rises without relaxing safety gates.
