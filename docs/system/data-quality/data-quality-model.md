# Data Quality Model

Summary: The Learning Hub Data Quality Fabric records evidence objects, validates contracts, and preserves fail-closed outcomes.

## Evidence objects
- supplier snapshot
- marketplace snapshot
- shipping quote
- stock signal
- match
- candidate decision
- listing decision
- publish outcome
- order outcome

## Canonical fields
Source, parser version, confidence, freshness, validation status, blocked reasons, downstream outcome, identity keys, timestamps, diagnostics.

## Contracts
Implemented in `src/lib/learningHub/contracts.ts`:
- required fields
- freshness thresholds
- confidence floors
- measurable weak/stale detection via reason codes
