# Listing Lifecycle

Summary: Listings move through controlled states with immutability and guarded publish rules.

## State path
`PREVIEW -> READY_TO_PUBLISH -> ACTIVE` with controlled transitions to paused/failed recovery states.

## Safeguards
- Supplier linkage immutability after approval thresholds
- Publish guardrails and idempotency
- Recovery/audit tracking for post-publish issues
