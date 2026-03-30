# Freshness And Update Policy

Summary: Learning truth has explicit SLAs. Stale knowledge must be visible, and stale learning cannot silently drive downstream automation.

## SLA domains

| Domain | Warn | Error | Autonomous effect |
| --- | --- | --- | --- |
| Supplier intelligence | 12h | 24h | Pause downstream recompute/publish |
| Shipping intelligence | 8h | 18h | Pause downstream recompute/publish |
| Category intelligence | 12h | 30h | Degrade prioritization and mark scorecards stale |
| Product-profile intelligence | 12h | 30h | Degrade prioritization and mark scorecards stale |
| Marketplace-fit intelligence | 12h | 30h | Degrade recommendations and mark scorecards stale |
| Opportunity scores | 6h | 18h | Pause opportunity-driven automation |
| Control-plane scorecards | 4h | 12h | Mark scorecards stale and warn operators |

## Implementation

- Policy definitions live in `src/lib/learningHub/freshness.ts`.
- Freshness reads canonical timestamps from `learning_evidence_events` and `learning_features`.
- No freshness state is inferred from manual page refreshes or UI caches.

## Enforcement

- `src/lib/learningHub/scorecard.ts` includes freshness state directly in the learning-hub scorecard payload.
- `src/lib/autonomousOps/backbone.ts` converts critical stale domains into self-pausing reasons.
- `src/lib/controlPlane/getControlPlaneOverview.ts` pushes stale knowledge warnings into the shared control-plane payload.
- `src/components/admin/ControlPlaneOverviewPanel.tsx` renders stale-domain warnings and scorecard staleness visibly across `/dashboard`, `/admin/control`, `/admin/review`, `/admin/listings`, and `/admin/orders`.

## Fail-closed behavior

- Shipping truth remains fail-closed.
- Stale opportunity scores do not silently reprioritize review or publish flow.
- Stale scorecards are visible in the control plane.
- AI summaries and ranking remain advisory only and do not bypass existing safety gates.
