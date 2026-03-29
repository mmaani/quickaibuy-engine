# Control-Plane Architecture

Canonical control-plane surfaces after the autonomy overhaul:

| Route | Primary loader(s) | Purpose |
| --- | --- | --- |
| `/dashboard` | `@/lib/dashboard/getDashboardData`, `@/lib/controlPlane/getControlPlaneOverview` | Freshness, pipeline health, autonomous stage truth |
| `/admin/control` | `@/lib/control/getControlPanelData`, `@/lib/controlPlane/getControlPlaneOverview` | Operational control, backbone status, recovery, self-pausing |
| `/admin/review` | `@/lib/review/console`, `@/lib/controlPlane/getControlPlaneOverview` | Candidate exceptions and approval blockers |
| `/admin/listings` | `@/lib/listings/getApprovedListingsQueueData`, `@/lib/controlPlane/getControlPlaneOverview` | Preview, ready-to-publish, recovery, listing integrity |
| `/admin/orders` | `@/lib/orders`, `@/lib/controlPlane/getControlPlaneOverview` | Purchase review, tracking, and remaining human tasks |

Canonical autonomous truth:

- Runtime/env diagnostics: `@/lib/autonomousOps/backbone`
- Live operational summary: `@/lib/autonomousOps/backbone`
- Shared UI summary model: `@/lib/controlPlane/getControlPlaneOverview`
- Canonical API surface: `/api/admin/control-plane`

Deprecated / replaced paths:

- `@/lib/server/controlPanelData`
- `@/lib/dashboard/getControlPanelData`

These were replaced because they either fetched duplicate control data indirectly or re-exported an unnecessary alias instead of using the canonical control-plane summary directly.
