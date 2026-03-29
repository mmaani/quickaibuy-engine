# Env and DB Targeting

Summary: Runtime env selection is explicit and DB targeting is classified before high-risk mutation paths run.

## Active env model (implemented)
- `.env.dev` and `.env.prod` are source snapshots.
- `.env` is generated active runtime file.
- `.env.local` is synchronized compatibility mirror.
- Runtime resolves via `DOTENV_CONFIG_PATH`, then `.env`, then `.env.local` fallback.

## Key commands
- `pnpm env:status`
- `pnpm env:dev`
- `ALLOW_PROD_ENV_SWITCH=true pnpm env:prod`
- `pnpm db:status`
- `pnpm runtime:diag`

## DB safety
- DB target classification: `DEV`, `PROD`, `PREVIEW`, `UNKNOWN`.
- Unknown target blocks mutation scripts.
