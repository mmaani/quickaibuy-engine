# Env and DB Targeting

Summary: Runtime env selection is explicit and DB targeting is classified before high-risk mutation paths run.

## Active env model (implemented)
- `.env.dev` and `.env.prod` are source snapshots.
- `.env` is generated active runtime file.
- `.env.local` is the synchronized compatibility mirror for tools that still auto-load it.
- `.env.active.json` is generated metadata describing the active target.
- Runtime resolves via `DOTENV_CONFIG_PATH`, then `.env`, then `.env.local` fallback.

## Operating rules on `main`

- `main` is the operating branch for daily work.
- Branch alone does not select `DEV` or `PROD`; DB target still comes from the active runtime env and DB classification.
- Normal operation should keep only canonical and compatibility env files in working exports.
- `.env.vercel`, `codex*.private`, and `railway_worker.env` are compatibility/export surfaces and should not be treated as the canonical local runtime source.

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

## Surface classification

- Canonical local runtime files: `.env`, `.env.active.json`, `.env.dev`, `.env.prod`
- Compatibility-only local file: `.env.local`
- Generated/export file for Railway worker handoff: `railway_worker.env`
- Sensitive compatibility/export files that should not drive normal local runtime: `.env.vercel`, `codex*.private`

## Codex sandbox readiness

- Codex/Spark sandboxed edits depend on `bubblewrap` plus workspace support for unprivileged namespace creation.
- The repo-side fix is now built into the Codespaces devcontainer image and validated by `NODE_ENV=production pnpm codespace:check`.
- That check runs `bwrap --ro-bind / / true` and fails closed if `bubblewrap` is missing or namespace creation is denied.
- If the check fails in an updated Codespace, rebuild the container first. If it still fails, the remaining blocker is Codespaces/container policy, not application runtime env or DB targeting.
