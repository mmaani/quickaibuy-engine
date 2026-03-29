# System Overview

Summary: QuickAIBuy is an operator-first, fail-closed marketplace automation pipeline with autonomous orchestration, manual safety gates, and evidence-backed listing/order flows.

## End-to-end flow
1. Supplier discovery + refresh generate `products_raw` evidence.
2. Marketplace scans create `marketplace_prices` snapshots.
3. Matching and profit evaluate into `matches` and `profitable_candidates`.
4. Review gate decides promotion to listing preview/ready states.
5. Listing lifecycle executes guarded publish and monitoring.
6. Order workflow remains manual-assisted for purchase/payment and automated for tracking/sync when safe.

## Canonical dependencies
- Data layer: `src/lib/db/schema.ts`
- Autonomous backbone: `src/lib/autonomousOps/backbone.ts`
- Control-plane aggregation: `src/lib/controlPlane/getControlPlaneOverview.ts`
- Learning hub quality fabric: `src/lib/learningHub/*`

## Safety boundaries
- Shipping/stock unknown states block publish progression.
- AI can score/recommend, not override fail-closed gates.
- Live publish remains explicitly guarded.
