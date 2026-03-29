# Drift and Anomaly Intelligence

Summary: Drift events are classified, severity-scored, and surfaced into control-plane insights and operational hints.

## Drift categories
- payload/missingness drift
- parser yield drift
- supplier instability
- freshness failures
- shipping/stock ratio regressions
- evidence and candidate pool degradation

## Classification
`src/lib/learningHub/drift.ts` computes delta ratios and classifies `info|warning|critical` with reason codes and action hints.

## Operational behavior
Critical drift should trigger tighter pause behavior and evidence refresh priority.
