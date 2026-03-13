# QuickAIBuy Engine

QuickAIBuy is an operator-first ecommerce intelligence and execution system.

The system prioritizes **safe operations, operator visibility, and fail-closed automation boundaries**.

Current focus:
- `eBay` live execution path (guarded)
- manual approval gates before listing execution
- manual-assisted order workflow and tracking sync controls
- admin consoles for review, listings, orders, and incident control

---

# Core Admin Routes

- `/dashboard` – monitoring dashboard with links to admin consoles
- `/admin/control` – operational control panel, safety alerts, manual overrides
- `/admin/review` – candidate review and approval gate
- `/admin/listings` – listing readiness and lifecycle operations
- `/admin/orders` – manual-assisted order operations (purchase/tracking/sync)

These surfaces form the **daily operating interface for system operators**.

---

# Operator Runbook

QuickAIBuy uses an **operator-first safety model**.

All incident handling and operational procedures are documented in:
- `docs/operator-runbook.md`
- `docs/runtime-diagnostics.md`
- `docs/database-migrations.md`

## Migration provenance (v1)

- Authoritative migration path going forward: `migrations/*.sql` only (forward-only additive SQL).
- Historical Drizzle ledger (`drizzle/`) remains as provenance metadata and transition diagnostics only.
- Pre/post migration verification command:

```bash
pnpm exec tsx scripts/check_migration_baseline.ts
```

(Equivalent alias: `pnpm exec tsx scripts/check_migration_ledger.ts`.)

## Queue namespace isolation contract

QuickAIBuy enforces environment-safe queue namespaces:

- Development: `BULL_PREFIX=qaib-dev`, `JOBS_QUEUE_NAME=jobs-dev`
- Production: `BULL_PREFIX=qaib-prod`, `JOBS_QUEUE_NAME=jobs-prod`

Production requires explicit `BULL_PREFIX=qaib-prod`; startup assertions fail fast when namespace values are unsafe or ambiguous. Use diagnostics:

```bash
pnpm exec tsx scripts/queue_namespace_diagnostics.ts
```

## Worker startup (explicit env selection)

- `pnpm worker:engine:dev`
  - Uses `DOTENV_CONFIG_PATH=.env.local`
  - Intended for local/dev branch infrastructure
- `pnpm worker:engine:prod`
  - Uses `DOTENV_CONFIG_PATH=.env.vercel`
  - Intended only when you explicitly need production-linked runtime checks
- `pnpm worker:engine`
  - Alias to `pnpm worker:engine:dev`

Both worker commands run dependency preflight before boot and fail fast with classified errors:
- `CONFIG_MISSING` for missing `DATABASE_URL` or `REDIS_URL`
- `DNS_FAILURE` for host resolution issues (for example `EAI_AGAIN`)
- `NETWORK_UNREACHABLE` when host resolves but endpoint is not reachable

When `DNS_FAILURE` or `NETWORK_UNREACHABLE` appears in restricted environments, the fix is external networking access (allow outbound DNS/TCP), not queue/runtime code changes.
