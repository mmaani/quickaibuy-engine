# Codex Defaults

- This repo's Codex environment may be preloaded from saved production settings for `mmaani/quickaibuy-engine`, but do not assume runtime DB variables are actually present in every execution context.
- Before any DB-backed analysis, validation, or production-impacting work, explicitly verify:
  - `DATABASE_URL` or `DATABASE_URL_DIRECT`
  - runtime DB target classification
  - whether the task is running in a DB-enabled environment
- If DB env is missing, fail explicitly and report that the task requires a DB-enabled runtime. Do not assume localhost and do not fabricate live-data conclusions.
- Do not ask the user to restate production env/secrets unless a task explicitly requires new secrets not already configured.
- Keep `ENABLE_EBAY_LIVE_PUBLISH=false` unless the user explicitly requests a guarded live publish action.
- Prefer deterministic, fail-closed, auditable changes.
- For operator/runtime truth, treat canonical sources as:
  - control plane
  - jobs worker
  - backbone
  - audit/logged DB truth
  not historical UI assumptions.
- When adding AI usage, keep it bounded, cached, explainable, and non-authoritative.