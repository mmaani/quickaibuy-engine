# Codex Defaults

- This repo's Codex environment is expected to be preloaded from the saved production settings for `mmaani/quickaibuy-engine`.
- Assume production values are already present in Codex environment variables and secrets unless a task explicitly says otherwise.
- Do not ask the user to restate production env/secrets on each task.
- Before any production-impacting work, verify the runtime target if there is any ambiguity.
- Keep `ENABLE_EBAY_LIVE_PUBLISH=false` unless the user explicitly requests a guarded live publish action.
