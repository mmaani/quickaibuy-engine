# Scheduled Learning Orchestration

Summary: Continuous learning uses one canonical scheduler and one canonical worker execution path.

## Scheduler

- Registration: `src/lib/jobs/enqueueContinuousLearningSchedules.ts`
- Worker execution: `src/workers/jobs.worker.ts`
- Runtime engine: `src/lib/learningHub/continuousLearning.ts`
- Recurring cadence: every 120 minutes
- Event-triggered refresh: canonical writer best-effort enqueues a delayed follow-up refresh

## Stage order

1. Supplier score recompute
2. Shipping quality recompute
3. Category intelligence recompute
4. Product-profile intelligence recompute
5. Marketplace-fit recompute
6. Attribute intelligence recompute
7. Opportunity score recompute
8. Drift/anomaly recompute
9. Scorecard refresh

## Dependency model

- Supplier/shipping feature refresh runs first because later intelligence depends on evidence quality.
- Product-market intelligence persists category/profile/marketplace-fit/attribute/opportunity features next.
- Freshness and scorecard health are refreshed after feature persistence so UI and pause logic read current state.

## Safe pause behavior

- Freshness-critical domains generate pause reasons through `computePauseMap`.
- Publish remains blocked on shipping unknowns, integrity spikes, and critical drift.
- Continuous learning never disables fail-closed safety. It only supplies fresher truth and clearer visibility.

## Consolidation

- Autonomous backbone no longer maintains a separate learning refresh implementation.
- Manual or ad hoc learning refresh scripts should not be treated as the normal path.
- Scheduled and event-triggered learning now converge on the same `learning:continuous-refresh` job family.
