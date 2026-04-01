# Codespaces Resume Note

Use this when reopening the Codespace and starting a fresh chat:

```text
Continue the Codespaces setup work in quickaibuy-engine. Verify the workspace is PROD, keep prod mutation guards closed, and inspect the current diff.
```

Current intended workspace state:

- Active DB target: `PROD`
- Env source: `.env.prod`
- Mutation safety: `PROD_BLOCKED`
- Codespaces attach checks: `pnpm db:status`, `NODE_ENV=production pnpm codespace:check`

Relevant files:

- `.devcontainer/devcontainer.json`
- `README.md`
- `docs/codespaces-resume.md`

Operator rule:

- Use this Codespace for prod visibility and diagnostics.
- Do not enable prod mutation overrides unless explicitly required for an intentional guarded action.
- End-to-end Codespaces validation fixes were completed and re-verified on 2026-04-01.
