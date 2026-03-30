# QuickAIBuy System Knowledge Layer

This folder is the canonical Markdown knowledge layer for architecture, runtime, automation, control-plane truth, data quality, learning hub behavior, and operational troubleshooting.

Use these docs as retrieval-safe references aligned to implemented code paths.

## Operating mode

- `main` is the operating branch.
- The canonical runtime is the active `.env` file plus DB target classification.
- The canonical daily operator command is `pnpm ops:full-cycle`.
- Manual human work remains supplier purchase/payment and exceptional investigations only.
- The operational command model and script classification live in:
  - `docs/system/automation/operational-surface.md`
  - `scripts/README.md`
- Continuous learning is documented in:
  - `docs/system/learning-hub/continuous-learning.md`
  - `docs/system/learning-hub/freshness-and-update-policy.md`
  - `docs/system/control-plane/live-scorecard-update-model.md`
  - `docs/system/automation/scheduled-learning-orchestration.md`
