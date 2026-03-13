# Database Migrations (v1 Baseline and Provenance)

## Thread
System Architecture

## Goal
Preserve runtime-safe schema state while removing migration-ledger ambiguity.

## Official v1 baseline (source of truth)
The official v1 baseline is a **documented hybrid baseline**:

1. Drizzle bootstrap ledger through `drizzle/0004_aromatic_reavers.sql`.
2. Runtime additive SQL chain in `migrations/*.sql` through `migrations/20260311f_add_manual_overrides.sql`.

This baseline matches current runtime-safe production behavior and must not be rewritten destructively.

## Authoritative migration path going forward
Starting now, QuickAIBuy uses **one authoritative forward path**:

- New schema changes must be committed as **forward-only additive SQL files under `migrations/`**.
- Apply with:

```bash
node scripts/mutate_execute_sql_file.mjs migrations/<timestamp>_<name>.sql
```

- Drizzle ledger is retained for historical/bootstrap provenance only; it is **not** the authority for new v1 migrations.

## Legacy awareness (transition only)
Legacy environments may still contain Drizzle ledger state differences.

Allowed use of legacy dual history:
- compatibility checks
- operator diagnostics
- transition runbooks

Not allowed:
- dual-authority operation
- guessing migration state from only one ledger

## Required verification before future migration rollout
Run this check before applying any new migration and again afterward:

```bash
pnpm exec tsx scripts/check_migration_baseline.ts
```

Alias:

```bash
pnpm exec tsx scripts/check_migration_ledger.ts
```


Additional runtime drift check (critical tables + indexes):

```bash
pnpm exec tsx scripts/check_schema_drift.ts
```

This verifies:
- expected v1 hybrid baseline markers
- required post-baseline runtime tables/columns
- legacy Drizzle ledger presence as transition metadata
- whether environment is safe for forward-only SQL migration usage

## Operator-safe rollout sequence (forward-only)
1. Baseline verification:
```bash
pnpm exec tsx scripts/check_migration_baseline.ts
```
2. Apply additive migration SQL in-order:
```bash
node scripts/mutate_execute_sql_file.mjs migrations/<file>.sql
```
3. Re-run verification:
```bash
pnpm exec tsx scripts/check_migration_baseline.ts
```

## Build/Ops note
`pnpm build` can emit transient `ENETUNREACH` during build-time network calls in restricted environments. Treat this as an operations/network preflight issue, not as migration-ledger corruption.

## Do not do this
- Do not mutate live tables to force a cleaner migration narrative.
- Do not delete or rewrite historical migration files for aesthetics.
- Do not run `db:push` against shared/prod environments.
- Do not ship out-of-band manual SQL that is not committed under `migrations/`.
- Do not preserve dual authority (`drizzle/` and `migrations/`) for new changes.

## Decision summary
- Baseline model: documented hybrid baseline.
- Forward path: single authority = `migrations/*.sql`.
- Legacy handling: awareness/checks only.
- Runtime safety: no destructive cleanup required.
