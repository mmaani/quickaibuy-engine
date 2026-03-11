# QuickAIBuy Engine

QuickAIBuy is an operator-first ecommerce intelligence and execution system.

Current focus:
- `eBay` live execution path (guarded)
- manual approval gates before listing execution
- manual-assisted order workflow and tracking sync controls
- admin consoles for review, listings, orders, and incident control

## Core Admin Routes
- `/dashboard` - monitoring dashboard with links to admin consoles
- `/admin/control` - operational control panel, safety alerts, manual overrides
- `/admin/review` - candidate review and approval gate
- `/admin/listings` - listing readiness and lifecycle operations
- `/admin/orders` - manual-assisted order operations (purchase/tracking/sync)

## Safety Model
The platform is designed to fail safely and keep operator control:
- review gate remains required
- eBay publish flow is guarded and rate-limited
- duplicate listing protections are enforced
- manual overrides exist for incident response:
  - `PAUSE_PUBLISHING`
  - `PAUSE_MARKETPLACE_SCAN`
  - `PAUSE_ORDER_SYNC`
  - `EMERGENCY_READ_ONLY`
- override state is persisted and audit-logged

For live eBay publish prerequisites and policy details, see [docs/ebay-live-publish.md](docs/ebay-live-publish.md).

## Order Automation Scope (Current)
Implemented foundation:
- eBay order sync ingestion with idempotent persistence
- one-page `/admin/orders` console for beginner operators
- manual purchase and tracking recording
- tracking readiness checks
- controlled per-order real tracking sync to eBay

Boundary (not implemented as autonomous flow yet):
- supplier API auto-purchase
- broad auto-sync/auto-fulfillment
- customer notification automation

## Local Setup
### Requirements
- Node.js 20+
- pnpm
- PostgreSQL (`DATABASE_URL`)
- Redis (`REDIS_URL`) for queue/worker paths

### Install
```bash
pnpm install
```

### Environment
Create `.env.local` with at minimum:
- `DATABASE_URL`
- `REDIS_URL`
- review auth vars (`REVIEW_CONSOLE_USERNAME`, `REVIEW_CONSOLE_PASSWORD`)
- required eBay vars for order/publish/sync flows when validating live paths

### Run app
```bash
pnpm dev
```

### Quality checks
```bash
pnpm lint
pnpm build
pnpm exec tsc --noEmit
```

## Database Migrations
Use project migrations in `migrations/`.

```bash
pnpm db:migrate
```

If your target environment has legacy baseline conflicts, apply additive migration files in a controlled manner and keep environment migration state aligned.

## Useful Operational Commands
```bash
# workers
pnpm worker:jobs
pnpm worker:engine

# diagnostics
pnpm probe:runtime
pnpm diag:db-fingerprint
pnpm diag:env-compare

# order/tracking checks
pnpm exec tsx scripts/check_tracking_sync_readiness.ts
pnpm exec tsx scripts/test_ebay_tracking_sync.ts <orderId> [supplierOrderId] [runLive=true|false]
```

## Engineering Notes
- Tech stack: Next.js App Router + Drizzle + Postgres + BullMQ
- Keep admin controls explicit and auditable
- Prefer additive, backward-compatible schema changes
- Do not broaden automation without guardrails and operator visibility
