# Codex Handoff

Last updated: 2026-04-03 UTC
Repo: `/workspaces/quickaibuy-engine`
Latest pushed commit: `f0c7d9c5` (`Fix AliExpress origin extraction heuristics`)

## Current state
- The original CJ candidate `1f58152c-ee17-4b35-ba80-7440f73aec6f` remains correctly blocked on economics.
- Latest verified economics state for that candidate remained underwater after refresh: profit `-4.44`, margin `-4.93%`, ROI `-8.66%`.
- No safe eBay candidate is currently `APPROVED`, `listing_eligible`, or `READY_TO_PUBLISH`.
- A wider supplier discovery wave was enqueued. Consume with `pnpm worker:jobs`.

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

## Recommended next steps
1. Keep `pnpm worker:jobs` running and monitor for new non-electronics supplier raws that can become viable eBay candidates.
2. Continue AliExpress work only if a new extraction source is available; do not assume parser-only changes will solve hidden-origin pages.
3. Investigate CJ verification/activation and logistics doc coverage to see whether CJ can provide stronger deterministic origin/shipping truth.
4. Prefer non-electronics, simpler, new-seller-friendly products when forcing targeted downstream evaluation.

## Resume prompt
Use this in a new Codex chat:

```text
Resume from commit f0c7d9c5 in /workspaces/quickaibuy-engine.

Read docs/codex-handoff.md first.
Continue the discovery + supplier-origin work without redoing completed steps.
Focus next on CJ API/account verification implications and the CJ docs tree starting from https://developers.cjdropshipping.com/en/api/introduction.html, while keeping the worker-backed discovery flow moving.
```
