# Env and DB Targeting

Summary: Runtime env selection is explicit and DB targeting is classified before high-risk mutation paths run.

## Active env model (implemented)
- `.env.dev` and `.env.prod` are source snapshots.
- `.env` is generated active runtime file.
- `.env.local` is synchronized compatibility mirror.
- Runtime resolves via `DOTENV_CONFIG_PATH`, then `.env`, then `.env.local` fallback.

## Operating rules on `main`

- `main` is the operating branch for daily work.
- Branch alone does not select `DEV` or `PROD`; DB target still comes from the active runtime env and DB classification.
- Normal operation should keep only canonical and compatibility env files in working exports.
- `.env.vercel` and `codex*.private` are legacy/sensitive export surfaces and should not be present in normal working operation.

## Key commands
- `pnpm env:status`
- `pnpm env:dev`
- `ALLOW_PROD_ENV_SWITCH=true pnpm env:prod`
- `pnpm db:status`
- `pnpm runtime:diag`
- `pnpm check:live-integrity`
- `pnpm ops:full-cycle`

## DB safety
- DB target classification: `DEV`, `PROD`, `PREVIEW`, `UNKNOWN`.
- Unknown target blocks mutation scripts.
