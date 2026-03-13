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

Run worker with explicit env selection:

```bash
pnpm worker:engine:dev
pnpm worker:engine:prod
```

`pnpm worker:engine` is an alias for `pnpm worker:engine:dev`.

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
2. `pnpm worker:jobs`
3. `pnpm worker:engine:dev` (or `:prod`)
4. order-specific checks

If external dependencies fail, stop and resolve connectivity/auth first.
