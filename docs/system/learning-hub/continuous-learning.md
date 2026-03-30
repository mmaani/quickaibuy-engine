# Continuous Learning Engine

Summary: QuickAIBuy now uses one canonical continuous-learning path for event writes, scheduled recompute, freshness enforcement, and control-plane propagation.

## Canonical path

- Immediate writes enter `src/lib/learningHub/pipelineWriters.ts` through `writePipelineLearningEvent`.
- Each canonical write persists evidence with observed timestamp, source, parser/runtime version, freshness metadata, blocked reasons, downstream outcome, and diagnostics.
- Event writes best-effort enqueue `JOB_NAMES.CONTINUOUS_LEARNING_REFRESH` through `src/lib/jobs/enqueueContinuousLearningSchedules.ts`.
- Scheduled recompute runs through `src/lib/learningHub/continuousLearning.ts`.
- The jobs worker owns the recurring registration and execution path in `src/workers/jobs.worker.ts`.

## Push-write coverage

- Supplier discovery results
- Supplier refresh outcomes
- Shipping recovery outcomes
- Marketplace scan outcomes
- Match decisions
- Profit decisions
- Listing prepare outcomes
- Listing promote outcomes
- Publish success/failure outcomes
- Order ingestion outcomes
- Tracking sync outcomes
- Customer outcome signals from canonical customer linking

## Recompute stages

Order is fixed and canonical:

1. `supplier_score_recompute`
2. `shipping_quality_recompute`
3. `category_intelligence_recompute`
4. `product_profile_intelligence_recompute`
5. `marketplace_fit_recompute`
6. `attribute_intelligence_recompute`
7. `opportunity_score_recompute`
8. `drift_anomaly_recompute`
9. `scorecard_refresh`

## Persistence model

- Supplier and shipping recompute refresh reusable supplier features.
- Category, profile, marketplace-fit, attribute, supplier-marketplace, and opportunity outputs are persisted as `learning_features`.
- Scorecard health and freshness health are also persisted as `learning_features`.
- Freshness state is tracked from canonical evidence and feature timestamps, not fabricated synthetic truth.

## Cleanup stance

- Continuous learning should flow through the worker schedule or event-trigger enqueue path, not ad hoc manual refresh scripts.
- Autonomous backbone health-summary refresh now calls the canonical continuous-learning refresh rather than its own separate learning recompute path.
