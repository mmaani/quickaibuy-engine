# Codespaces Resume Note

Use this when reopening the Codespace and starting a fresh chat:

```text
Continue the Codespaces setup work in quickaibuy-engine. Verify the workspace is PROD, keep prod mutation guards closed, validate Codex sandbox namespace readiness, and inspect the current diff.
```

Current intended workspace state:

- Active DB target: `PROD`
- Env source: `.env.prod`
- Mutation safety: `PROD_BLOCKED`
- Codespaces attach checks: `pnpm db:status`, `NODE_ENV=production pnpm codespace:check`
- Codespace sandbox readiness: `pnpm codespace:check` must report `Codex sandbox namespace readiness` as `OK`

Relevant files:

- `.devcontainer/devcontainer.json`
- `.devcontainer/Dockerfile`
- `.devcontainer/bootstrap.sh`
- `scripts/check_codespace_runtime.ts`
- `README.md`
- `docs/codespaces-resume.md`

Operator rule:

- Use this Codespace for prod visibility and diagnostics.
- Do not enable prod mutation overrides unless explicitly required for an intentional guarded action.
- If `Codex sandbox namespace readiness` fails, rebuild the container first so the new devcontainer image installs `bubblewrap`; if the failure persists, treat it as a Codespaces/container policy issue rather than a repo bug.
- End-to-end Codespaces validation fixes were completed and re-verified on 2026-04-04.
