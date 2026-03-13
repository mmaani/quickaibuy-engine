# Runtime Diagnostics Guide

## Why this exists

QuickAIBuy depends on external services for queue, database, and deployment environment checks.
When those dependencies fail, operators should get clear failure classes and safe next steps.

## Failure classes

- `OK`: dependency check passed
- `CONFIG_MISSING`: required env var, CLI, or project link is missing
- `DNS_FAILURE`: hostname resolution failed (commonly `EAI_AGAIN`)
- `AUTH_FAILURE`: login/token/permission failed
- `NETWORK_UNREACHABLE`: endpoint was resolved but not reachable
- `UNKNOWN`: unclassified failure; rerun with `DIAG_VERBOSE=1`

## EAI_AGAIN in Codespaces

`EAI_AGAIN` usually means transient DNS failure in runtime networking.
It is usually external, not an application logic bug.

Safe response:
1. Wait 30-60 seconds
2. Rerun preflight/diagnostics
3. If persistent, verify DNS and endpoint status

## Commands

Run full dependency preflight:

```bash
pnpm preflight:runtime-deps
```

Run explicit env preflight:

```bash
pnpm preflight:runtime-deps:dev
pnpm preflight:runtime-deps:prod
```

Run workers with explicit role and env selection:

```bash
pnpm worker:jobs
pnpm worker:engine:dev
pnpm worker:engine:prod
```

- `pnpm worker:jobs`: generic BullMQ jobs consumer; consumes queued jobs such as `supplier-discover`.
- `pnpm worker:engine:dev`: engine/runtime worker boot path with `.env.local`; not the generic queue consumer.
- `pnpm worker:engine:prod`: same engine/runtime worker boot path with `.env.vercel`; not the generic queue consumer.

`pnpm worker:engine` is an alias for `pnpm worker:engine:dev`.

## Which worker should I run?

- For queue consumption (`supplier-discover`, other BullMQ jobs): run `pnpm worker:jobs`.
- For engine/runtime boot-path diagnostics in local/dev context: run `pnpm worker:engine:dev`.
- For engine/runtime boot-path diagnostics against prod-linked env: run `pnpm worker:engine:prod`.

Check runtime probe quickly:

```bash
pnpm probe:runtime
```

Check DB fingerprint with classified failures:

```bash
pnpm diag:db-fingerprint
```

Check Vercel env access (CLI/auth/link/pull):

```bash
pnpm diag:vercel-env-access
```

Compare local vs Vercel env values:

```bash
pnpm diag:env-compare
```

Check resolved queue namespace contract:

```bash
pnpm diag:queue-namespace
```

Check inventory risk recurring schedule state:

```bash
pnpm check:inventory-risk-schedule
```

Manual on-demand inventory risk scan trigger:

```bash
pnpm enqueue:inventory-risk-scan
```

Find a real order for tracking-sync test:

```bash
pnpm check:tracking-test-order
```

## Manual verification tips

Verify Neon DNS:

```bash
node -e "require('dns').lookup('YOUR_NEON_HOST', console.log)"
```

Verify Upstash DNS:

```bash
node -e "require('dns').lookup('YOUR_UPSTASH_HOST', console.log)"
```

Verify Vercel auth/link:

```bash
vercel whoami
vercel link
```

## Safe rerun order

1. `pnpm preflight:runtime-deps:dev` (or `:prod` if intentionally targeting production env file)
2. `pnpm worker:jobs` (for queued job consumption)
3. `pnpm worker:engine:dev` (or `:prod`) for engine/runtime boot-path validation
4. order-specific checks

If external dependencies fail, stop and resolve connectivity/auth first.

## Inventory Risk Recurring Cadence (v1)

- Recurring job: `INVENTORY_RISK_SCAN`
- Cadence: every 6 hours
- Registration point: `pnpm worker:jobs` boot path ensures schedule idempotently
- Namespace safety: uses `JOBS_QUEUE_NAME` + `BULL_PREFIX` from queue namespace contract
- Manual trigger remains available via:
  - `pnpm enqueue:inventory-risk-scan`
  - admin control quick-action API action key: `inventory-risk-scan`

Operator verification steps:
1. Start `pnpm worker:jobs`.
2. Run `pnpm check:inventory-risk-schedule`.
3. Confirm exactly one `INVENTORY_RISK_SCAN` repeatable entry exists with `every` = `21600000` ms.
4. Optionally run `pnpm enqueue:inventory-risk-scan` and verify queue activity in the same check output.
