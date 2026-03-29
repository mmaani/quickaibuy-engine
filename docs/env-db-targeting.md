# Environment And DB Targeting

## Active env model

- `.env.dev` is the local development snapshot.
- `.env.prod` is the production-aligned snapshot.
- `.env` is the generated active env file used by default local tooling.
- `.env.local` is kept in sync as a generated compatibility mirror for Next.js, which loads it ahead of `.env`.
- `.env.active.json` records which source file generated `.env`.
- `.env.vercel` and `codex*.private` files are not part of the canonical runtime path and should not be relied on for normal local operations.

Default resolution order:

1. `DOTENV_CONFIG_PATH` if explicitly set
2. `.env`
3. legacy fallback `.env.local`

## Commands

- `pnpm env:status`
- `pnpm env:dev`
- `ALLOW_PROD_ENV_SWITCH=true pnpm env:prod`
- `pnpm runtime:diag`
- `pnpm db:status`
- `pnpm db:assert-dev`
- `pnpm db:assert-prod`

## DB target classification

The repo classifies the current database target as one of:

- `DEV`
- `PROD`
- `PREVIEW`
- `UNKNOWN`

Classification uses:

- active env source
- `DATABASE_URL` host
- `DATABASE_URL_DIRECT` host

If `DOTENV_CONFIG_PATH=.env` is set explicitly, classification still resolves through `.env.active.json` so an active `.env` generated from `.env.dev` or `.env.prod` does not degrade to `UNKNOWN`.

Patterns are defined in [config/db-targets.mjs](/workspaces/quickaibuy-engine/config/db-targets.mjs).

## Mutation safety

Non-prod mutation scripts require:

- `ALLOW_MUTATION_SCRIPTS=true`

Production mutation scripts require all of:

- `ALLOW_MUTATION_SCRIPTS=true`
- `ALLOW_PROD_DB_MUTATION=true`
- `CONFIRM_PROD_DB_TARGET=YES`

If the DB target is `UNKNOWN`, mutations are blocked until the target is classified clearly.

## Emergency procedure

1. Run `pnpm db:status`.
2. Confirm the env source and DB host.
3. If you truly intend to mutate prod, export all three production override variables.
4. Run the guarded mutation command once.
5. Unset the production override variables when done.
