# Codex Handoff

Last updated: 2026-04-04 UTC
Repo: `/workspaces/quickaibuy-engine`
Latest pushed commit: `f0c7d9c5` (`Fix AliExpress origin extraction heuristics`)

## Current state
- The original CJ candidate `1f58152c-ee17-4b35-ba80-7440f73aec6f` remains correctly blocked on economics.
- Latest verified economics state for that candidate remained underwater after refresh: profit `-4.44`, margin `-4.93%`, ROI `-8.66%`.
- No safe eBay candidate is currently `APPROVED`, `listing_eligible`, or `READY_TO_PUBLISH`.
- As of `2026-04-04T10:37:46Z`, `profitable_candidates` still contains only two rows:
  - CJ `78ABC8CE-379F-437F-8FA9-31CF39210E66` -> eBay `v1|354967917169|0`, still underwater.
  - AliExpress `3256811661826559` -> eBay `v1|389648987101|0`, near breakeven (`estimated_profit 0.01`) but blocked on missing ship-from-country.
- A wider supplier discovery wave was enqueued. Consume with `pnpm worker:jobs`.
- `pnpm worker:jobs` was re-run on `2026-04-04` and the worker booted cleanly on the production-classified runtime, picked up the scheduled supplier/match/profit jobs, and completed `EVAL_PROFIT` with `insertedOrUpdated: 2`.

## Code completed
- AliExpress origin/shipping extraction was broadened in:
  - `src/lib/products/suppliers/parserSignals.ts`
  - `src/lib/products/suppliers/aliexpress.ts`
- Regression coverage was added in:
  - `src/lib/products/__tests__/supplierEvidenceClassification.test.ts`
- Verification run that passed:
  - `pnpm test -- src/lib/products/__tests__/supplierEvidenceClassification.test.ts`

## Important operational finding
- The parser fix is real and tested, but representative live AliExpress products still came back `us_origin_unresolved` after exact-match refresh.
- That means at least some AliExpress pages being fetched still do not expose deterministic origin truth in the retrieved content. The remaining blocker is not only parser logic; it is also supplier evidence availability in fetched pages.

## Continue work on CJ
Track and continue work on CJ account/API readiness and docs review.

### CJ portal/account status observed
- CJ portal API page showed this warning:
  `This API-connected store is not yet verified. Please contact the CJ team via online chat with your API usage details to activate the store.`
- `/logistic/freightCalculate` was callable and had usage recorded.
- Treat the displayed CJ API key as sensitive. Do not copy it into commits, docs, logs, or tickets. If referencing it, redact it.

### CJ verification implications confirmed from docs
- Public CJ docs explicitly state that unverified users are capped at `1,000 calls/day per interface`.
- The docs also state access frequency is tiered by user level, with the lowest tier limited to `1 request/second`.
- Activation/verification requires:
  - an integration demo video,
  - backend/store verification screenshot,
  - CJ user ID with verified email and bound WhatsApp,
  - applicant/integration identity details.
- This makes the portal warning operationally relevant, not cosmetic: current auth may work, but unverified status can still limit sustained discovery/logistics usage.

### CJ follow-up work
- Confirm whether CJ store/API verification is limiting shipping/logistics detail quality or availability for product-level workflows.
- Check whether additional CJ endpoints can improve deterministic origin/shipping truth beyond current freight quote usage.
- Prioritize logistics-related CJ docs and operational constraints first, because economics and supplier gating depend on them.

## Continue work on CJ docs
Canonical public entry point:
- `https://developers.cjdropshipping.com/en/api/introduction.html`

Continue reviewing from the introduction page through the linked docs tree, especially:
- `Introduction`
- `Update Announcements`
- `Start / Development`
- `Start / Get Access-token`
- `Start / Practical Tool`
- `Start / Orders Synchronization Processing`
- `Start / Products Synchronization Processing`
- `Start / Webhook`
- `Start / Sandbox`
- `Start / Interface Call Restrictions`
- `API / Authentication`
- `API / Setting`
- `API / Product`
- `API / Storage`
- `API / Shopping`
- `API / Logistic`
- `API / Dispute`
- `API / Webhook`
- `Appendix 1: Global Error Codes`
- `Appendix 2: Country Code`
- `Appendix 3: Platforms`

### CJ docs findings already reviewed
- Authentication docs align with the current implementation:
  - access token TTL `15 days`
  - refresh token TTL `180 days`
  - `getAccessToken` should use `apiKey`
  - token responses are server-side cached within a `24h` window
- Product docs expose more than the current integration uses:
  - `product/listV2`
  - `product/getProductById`
  - `product/variant/queryByVid`
  - `product/stock/queryBySku`
  - `product/stock/getInventoryByPid`
- Storage docs expose `warehouse/detail`, which can map warehouse IDs to concrete country/location truth.
- Logistics docs explicitly say `logistic/freightCalculate` is the simple mode and recommend `logistic/freightCalculateTip` for more accurate trial calculation.

### CJ integration gap now clarified
- Current code in `src/lib/products/suppliers/cjdropshipping.ts` now uses:
  - auth endpoints,
  - `product/listV2`,
  - cache product detail/inventory JSON,
  - `logistic/freightCalculateTip` as the preferred direct-product logistics trial path,
  - `logistic/freightCalculate` as the fallback path
- Current code still does not yet use:
  - `warehouse/detail`
  - `product/stock/getInventoryByPid`
- Inference: if CJ verification is granted, the next meaningful implementation step is to upgrade origin/location truth further through warehouse and inventory endpoints rather than continuing parser-only work elsewhere.

## Recommended next steps
1. Keep `pnpm worker:jobs` running and monitor for new non-electronics supplier raws that can become viable eBay candidates.
2. Continue AliExpress work only if a new extraction source is available; do not assume parser-only changes will solve hidden-origin pages.
3. Treat CJ verification/activation as a prerequisite for dependable higher-volume logistics discovery, because the unverified state likely constrains the exact workflow now under investigation.
4. For CJ, prioritize `warehouse/detail` and inventory-endpoint usage next, now that `freightCalculateTip` is already in the direct-product refresh path.
5. Prefer non-electronics, simpler, new-seller-friendly products when forcing targeted downstream evaluation.

## Next viable non-electronics eBay candidate
- Best currently materialized row in `profitable_candidates`:
  - AliExpress `3256811661826559`
  - Title: `Aesthetic Doughnut LED Night Lamp – Cozy Ambient Light, Touch Control,Warm Color(Pink)`
  - eBay listing: `v1|389648987101|0`
  - Match confidence remained strong (`0.9712`)
  - Still blocked by `MISSING_SHIP_FROM_COUNTRY`
- Better emerging lead from fresh `matches` data, not yet in `profitable_candidates`:
  - AliExpress `3256807866121915`
  - Title: `Bauhaus table lamp USB plug bedroom bedside lamp living room dining room decoration donut ambient light (Not glass)`
  - eBay listing: `v1|406390434057|676712140563`
  - Match confidence `0.8678`, marketplace price `31.99`, supplier price seen around `10.21` to `11.87`
  - Still carries `shipping_signal=MISSING` and no deterministic ship-from-country in `products_raw`
  - This is the next non-electronics candidate worth forcing through origin/shipping truth recovery before spending more effort on weaker matches

## Resume prompt
Use this in a new Codex chat:

```text
Resume from commit a1fc7c91 in /workspaces/quickaibuy-engine.

Read docs/codex-handoff.md first.
Continue the discovery + supplier-origin work without redoing completed steps.
Focus next on CJ API/account verification implications and the CJ docs tree starting from https://developers.cjdropshipping.com/en/api/introduction.html, while keeping the worker-backed discovery flow moving.
Prioritize the AliExpress/Bauhaus donut lamp lead (supplier product 3256807866121915) as the next non-electronics candidate if no stronger candidate has materialized.
```
