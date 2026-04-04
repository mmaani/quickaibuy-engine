# QuickAIBuy Engine

QuickAIBuy is an operator-first ecommerce intelligence and execution system.

The system prioritizes **safe operations, operator visibility, and fail-closed automation boundaries**.

Governance and isolation docs:
- `docs/PROJECT_SCOPE.md`
- `docs/AGENT_RULES.md`
- `docs/SECURITY_POLICY.md`
- `docs/PROJECT_ISOLATION.md`
- `docs/PIPELINE_SCOPE.md`
- `docs/SUPPLIER_CRAWL_POLICY.md`
- `docs/PUBLISHING_GUARDRAILS.md`

Current focus:
- `eBay` live execution path (guarded)
- manual approval gates before listing execution
- manual-assisted order workflow and tracking sync controls
- admin consoles for review, listings, orders, and incident control
- deterministic supplier ship-from and shipping truth before publish progression
- worker-backed supplier discovery with fail-closed candidate advancement

---

# Core Admin Routes

- `/dashboard` – monitoring dashboard with links to admin consoles
- `/admin/control` – operational control panel, safety alerts, manual overrides
- `/admin/review` – candidate review and approval gate
- `/admin/listings` – listing readiness and lifecycle operations
- `/admin/orders` – manual-assisted order operations (purchase/tracking/sync)

These surfaces form the **daily operating interface for system operators**.

This repository is for QuickAIBuy only. If instructions or repo context suggest Zomorod Medical Supplies, Nivran, or another project belongs in this codebase, treat that as `PROJECT MISMATCH DETECTED` and stop until clarified.

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

- `pnpm worker:jobs`
  - Generic BullMQ jobs consumer for the `jobs` queue
  - Consumes queued jobs such as `supplier-discover`, `MATCH_PRODUCT`, and `EVAL_PROFIT`
- `pnpm worker:engine:dev`
  - Runs `pnpm env:dev` first
  - Boots the engine/runtime worker path
  - Not the generic consumer for all queued jobs
- `pnpm worker:engine:prod`
  - Runs `ALLOW_PROD_ENV_SWITCH=true pnpm env:prod` first
  - Boots the same engine/runtime worker path against the prod-linked runtime
  - Not the generic consumer for all queued jobs

There is no standalone `pnpm worker:engine` alias in the current package scripts.

`worker:engine:*` commands run dependency preflight before boot and fail fast with classified errors:
- `CONFIG_MISSING` for missing `DATABASE_URL` or `REDIS_URL`
- `DNS_FAILURE` for host resolution issues (for example `EAI_AGAIN`)
- `NETWORK_UNREACHABLE` when host resolves but endpoint is not reachable

When `DNS_FAILURE` or `NETWORK_UNREACHABLE` appears in restricted environments, the fix is external networking access (allow outbound DNS/TCP), not queue/runtime code changes.

Current operator note:
- `pnpm worker:jobs` was re-verified on `2026-04-04` against the production-classified runtime and remained the canonical path for supplier discovery progression.
- Current non-electronics discovery work is still blocked primarily by missing ship-from-country truth, not by queue-consumption failures.

## Codespaces note

This repo now includes `.devcontainer/devcontainer.json` so new Codespaces start in a defined Node 24 / pnpm environment.

GitHub Codespaces idle shutdown is still controlled by GitHub account or organization policy, not by repository code. If a stopped Codespace opens as `https://*.github.dev/?autoStart=false`, start it from the Codespaces UI or remove the `autoStart=false` query parameter from the URL so the browser is allowed to start the Codespace.

On Codespaces attach, the devcontainer now runs `pnpm db:status` and `pnpm codespace:check` so the shell prints the DB target classification and validates the prod-safe Codespaces runtime path immediately. For this workspace, the recommended operating model is PROD for visibility and diagnostics, with prod mutation guards left closed unless an intentional override is required.

## Which worker should I run?

- Run `pnpm worker:jobs` when you need queued BullMQ jobs consumed (including `supplier-discover`).
- Run `pnpm worker:engine:dev` for local engine/runtime boot path checks.
- Run `pnpm worker:engine:prod` only when intentionally validating prod-linked engine/runtime boot behavior.
