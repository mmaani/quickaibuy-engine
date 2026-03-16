# QuickAIBuy Pipeline Scope

The repo currently supports these major pipeline layers:

- supplier discovery and supplier product refresh
- trend ingestion and candidate expansion
- product matching between supplier items and marketplace candidates
- marketplace price scanning and snapshot maintenance
- profit evaluation and price-guard checks
- operator review and approval workflows
- listing preview preparation, readiness gating, and guarded publish
- listing monitoring and recovery flows
- order ingestion, manual-assisted purchase handling, and tracking sync
- inventory risk monitoring
- admin dashboards, diagnostics, queues, workers, and migration tooling around the pipeline

This scope is based on the current `src/`, `scripts/`, and existing docs in the repository. Do not add unsupported stages to governance docs unless code and operations files clearly support them.
