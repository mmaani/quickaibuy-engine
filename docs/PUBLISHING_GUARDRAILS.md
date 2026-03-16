# Publishing Guardrails

QuickAIBuy includes listing preparation, readiness gating, guarded publish, and publish monitoring flows. The guardrails in this repo are:

## Default Safety Posture

- Publish remains fail-closed by default.
- `ENABLE_EBAY_LIVE_PUBLISH` must stay `false` unless a guarded live publish action is explicitly intended.
- Manual approval and readiness checks remain part of the publish path.

## Supported Guardrails

- listing preview validation before publish
- duplicate protection and publish idempotency
- daily listing caps and publish rate limits
- ready-to-publish gating before execution
- recovery and paused-listing handling
- publish monitoring and stale publish remediation

## Environment And Credential Controls

- eBay credentials and policy IDs must come from env only.
- Public site URLs used for marketplace configuration must be derived from controlled env config.
- Do not hardcode credentials, tokens, or seller account data in code or docs.

## Operator Expectations

- Use diagnostics and guarded publish scripts before enabling live publish.
- Treat publish mutations as high-risk actions.
- Keep auditability and explicit operator intent in place for listing execution and recovery actions.
