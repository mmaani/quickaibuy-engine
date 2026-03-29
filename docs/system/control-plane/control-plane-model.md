# Control Plane Model

Summary: The control plane exposes canonical runtime truth, anomaly groups, recommendations, and learning-quality scorecards from a single aggregator.

## Source of truth
- `src/lib/controlPlane/getControlPlaneOverview.ts`
- API: `src/app/api/admin/control-plane/route.ts`
- UI: `src/components/admin/ControlPlaneOverviewPanel.tsx`

## Metrics
- Pipeline state (`healthy|watch|paused`)
- Shipping/integrity blockers
- Supplier reliability and candidate mix
- Learning hub scorecard (evidence quality, drift, features, evals)
