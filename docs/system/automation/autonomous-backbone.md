# Autonomous Backbone

Summary: The autonomous backbone coordinates diagnostics, recovery, refresh, candidate progression, and guarded publish with stage-level pause reasoning.

## Canonical operating command

- Daily operation from `main` uses `pnpm ops:full-cycle`.
- `pnpm ops:autonomous` remains the lower-level phase runner for diagnostics, prepare, publish, or direct backbone execution.
- The full-cycle runner wraps:
  - runtime diagnostics
  - live-state integrity check
  - autonomous diagnostics/refresh
  - supplier wave / refresh
  - marketplace refresh
  - shipping recovery
  - candidate recompute
  - prepare
  - publish-ready promotion
  - guarded publish
  - final summary

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
