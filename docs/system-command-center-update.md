# System Command Center Update (Current Repository Snapshot)

_Last updated: 2026-03-12 UTC_

## 1) Main branch code status (what is currently available)

### Current branch reality
- The local repository currently has **one local branch**: `work`.
- There is **no configured remote** and no local `main` ref available for direct checkout.
- The most recent commit on `work` is:
  - `fe3e407 chore: push current workspace changes`

### Closest known main baseline in local history
- History includes a merge commit message indicating `main` was merged previously:
  - `b12cc4a Merge branch 'main' into codex/define-migration-ledger-cleanup-plan-4zvno6`
- Practical command-center interpretation:
  - Treat commit `b12cc4a` as the nearest recoverable "main lineage point" available in this clone.

### Delta from that baseline to current HEAD
`git diff --stat b12cc4a..HEAD` shows only two files changed:
- `repo_tree.txt`
- `src/lib/queueNamespace.ts`

This means the currently available codebase is essentially main-line plus a focused queue namespace adjustment and tree refresh.

---

## 2) Up-to-date health checks

### Lint
- `pnpm -s lint` completed successfully (no blocking lint errors).

### Production build
- `pnpm -s build` completed successfully.
- During build, repeated `ENETUNREACH` `AggregateError` messages were emitted while page data/static generation was running, then build recovered and finalized successfully.

Command-center meaning:
- The app can build, but **network-dependent runtime paths are invoked during build-time execution** in this environment.
- This is non-fatal here, but indicates a reliability risk for CI/CD environments with restricted outbound network.

---

## 3) Bugs / risk findings (prioritized)

## P1 — Build-time network dependency leakage
**Symptoms**
- Repeated `ENETUNREACH` errors during `next build` page-data/static generation.

**Likely cause pattern**
- Server-side data loaders and API-linked fetch paths are being executed during build or pre-render phases where network egress may be unavailable.

**Operational impact**
- Non-deterministic builds across environments.
- Potential future hard failures if framework behavior/timing changes or if stricter CI networking is applied.

**Recommendation**
1. Guard network fetches during build (`process.env.NEXT_PHASE === 'phase-production-build'` checks in sensitive loaders).
2. Prefer direct function invocation over self-HTTP calls where possible for internal data (`/api/...` loops inside same app).
3. Add a CI gate that fails on unexpected build-time network calls.

---

## P1 — Missing branch/remote recoverability for command-center ops
**Symptoms**
- No `origin` remote and no local `main` ref in this workspace snapshot.

**Operational impact**
- Cannot definitively answer "main branch code" from Git metadata in this clone alone.
- Increases risk of shipping from ambiguous baseline.

**Recommendation**
1. Re-attach canonical remote (`origin`) in operational environments.
2. Enforce local refs: `main`, release branch, and protected tag pointer.
3. Add a startup check in operator scripts that verifies branch and remote integrity before running state-changing actions.

---

## P2 — Queue namespace safety depends on environment correctness
**Symptoms**
- Queue prefix resolution is environment-derived (`APP_ENV`, `VERCEL_ENV`, `NODE_ENV`) with fallback to `qaib-dev`.

**Operational impact**
- If env classification drifts, jobs can land in wrong namespace (cross-env queue collision risk).

**Recommendation**
1. Make `BULL_PREFIX` mandatory in production deployments.
2. Add runtime startup assertion that blocks worker boot if resolved prefix does not match expected environment contract.
3. Add a diagnostics endpoint exposing resolved queue prefix and queue names.

---

## 4) Command-center execution plan (direct)

### Immediate (today)
1. Treat current deployable baseline as `work@fe3e407`.
2. Record `b12cc4a` as the nearest main-line anchor available in this clone.
3. Open ticket: "Remove build-time internal HTTP dependencies from page generation path".

### This week
1. Add environment/namespace boot assertions for workers and queue producers.
2. Add CI job step to parse `next build` logs and fail on network egress unless explicitly allowed.
3. Restore remote and protected branch metadata in command-center environment.

### This sprint
1. Refactor internal API self-fetches into shared service functions.
2. Add command-center dashboard card: "Build determinism / network independence".
3. Add runbook section "How to recover authoritative main baseline when local refs are missing".

---

## 5) Exact commands used for this update

```bash
pwd && rg --files -g 'AGENTS.md'
git status --short --branch && git branch -vv
git remote -v && git fetch --all --prune && git branch -a
rg --files | head -n 200
sed -n '1,220p' README.md
cat package.json
pnpm -s lint
pnpm -s build
rg -n "TODO|FIXME|HACK|BUG|XXX|@ts-ignore" src docs scripts | head -n 200
git log --oneline --decorate -n 10
git diff --stat b12cc4a..HEAD
sed -n '1,220p' src/lib/queueNamespace.ts
rg -n "fetch\(|https?://" src/app src/lib | head -n 200
sed -n '1,220p' src/lib/server/controlPanelData.ts
```
