# QuickAIBuy Agent Rules

## Required Task Header

Every future task must declare:

- `PROJECT`
- `REPO`
- `THREAD`
- `GOAL`

Expected values for this repo:

- `PROJECT: QUICKAIBUY`
- `REPO: quickaibuy-engine`

## Pre-Flight Check

Before making changes, agents must:

1. confirm the current project is QuickAIBuy
2. confirm the repository context is `quickaibuy-engine`
3. confirm the files and requested work belong to QuickAIBuy
4. confirm no instructions, docs, or UI text reference another project as if it belongs here

Agents must inspect the repository before changes. At minimum, inspect the repo structure, relevant docs, and the specific files being changed before editing.

## Stop-On-Mismatch

If any instruction, file, branch context, doc text, or UI content suggests Zomorod Medical Supplies, Nivran, or another project is part of this repo, stop and report:

`PROJECT MISMATCH DETECTED`

Do not rename the project boundary to fit the task. Do not reuse terminology, code, prompts, or architecture from another project unless the user explicitly requests a migration and the repository evidence supports it.

## Security And Runtime Rules

- Use environment-based secrets only.
- Secrets may live in hosting environment variables or ignored local env files only.
- Never commit secrets, tokens, credentials, copied production env dumps, or generated auth material.
- Never print secret values into docs, logs, screenshots, tests, or examples.
- Do not expose server-only secrets to client bundles.
- Keep `ENABLE_EBAY_LIVE_PUBLISH=false` unless the user explicitly requests a guarded live publish action.

## Repo Hygiene

- Do not commit generated runtime artifacts unless they are intentional checked-in assets.
- Generated AI/source bundle folders and zip artifacts are local outputs, not source of truth.
- Preserve valid existing governance and security guidance when updating docs.
- Make minimal safe changes and avoid unsupported subsystem invention.
