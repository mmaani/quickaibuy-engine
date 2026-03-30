# Live Scorecard Update Model

Summary: Control-plane scorecards now update from live learning evidence and the canonical continuous-learning refresh path instead of relying on manual refresh assumptions.

## Shared payload

- Canonical loader: `src/lib/controlPlane/getControlPlaneOverview.ts`
- Shared panel: `src/components/admin/ControlPlaneOverviewPanel.tsx`
- Routes consuming the shared payload:
  - `/dashboard`
  - `/admin/control`
  - `/admin/review`
  - `/admin/listings`
  - `/admin/orders`

## What updates live

- Learning-hub evidence pass/warn/fail counts
- Open drift totals
- Supplier, shipping, and stock quality scorecards
- Category/profile/marketplace-fit/opportunity intelligence
- Continuous-learning cadence and last recompute status
- Stale knowledge warnings
- Freshness-driven self-pausing reasons

## Update flow

1. Source pipeline event writes evidence immediately.
2. Canonical writer best-effort enqueues `learning:continuous-refresh`.
3. Scheduled recompute persists refreshed learning features and scorecard health.
4. Control-plane overview reads current scorecards and freshness state directly.
5. Shared panel renders stale/warn/error status without route-specific refresh logic.

## Operator meaning

- A visible stale warning means scorecards are still shown, but must be treated as aged truth.
- A freshness pause reason means autonomous backbone stages should remain defensive until learning truth recovers.
