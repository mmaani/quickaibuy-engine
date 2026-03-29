# Autonomous Backbone

Summary: The autonomous backbone coordinates diagnostics, recovery, refresh, candidate progression, and guarded publish with stage-level pause reasoning.

## Stage model
- Runtime preflight
- Integrity healing
- Supplier/marketplace refresh
- Candidate progression
- Publish guardrails
- Order follow-up schedules

## Self-pausing
Pause map reasons are computed from runtime health and quality blockers (shipping unknown, stale data, integrity drift).

## Safety
Backbone does not bypass review or fail-closed constraints.
