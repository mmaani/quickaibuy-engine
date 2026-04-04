# Common Blockers

Summary: Canonical blocker reason-codes explain why progression halts and what evidence is missing.

## Frequent blockers
- `STOCK_UNKNOWN`
- `SHIPPING_UNKNOWN`
- `MISSING_SHIP_FROM_COUNTRY`
- stale marketplace/supplier snapshots
- linkage/integrity violations
- orphaned preview/active states
- stage-level pause reasons

## Current interpretation
- `MISSING_SHIP_FROM_COUNTRY` is a first-class fail-closed blocker, not a soft warning.
- Strong title match or attractive marketplace spread does not override missing supplier origin truth.
- Current non-electronics candidate work is concentrated here: donut-lamp / ambient-light candidates are commercially interesting but still blocked until origin becomes deterministic.
- CJ account-verification constraints can indirectly worsen shipping/logistics evidence quality and should be treated as an upstream blocker when relevant.
