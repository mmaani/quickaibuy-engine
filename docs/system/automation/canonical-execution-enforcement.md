THREAD:
Operational Surface Consolidation — Canonical Execution Enforcement

GOAL:
Enforce one sovereign execution path for production mutations and publish behavior: Entry -> Control Plane -> Backbone -> Worker -> Learning Hub -> Output. All non-canonical mutation entrypoints must be either hard-blocked, redirected into queue-backed worker flow, or explicitly restricted to diagnostics-only mode with surfaced visibility.

EXECUTION FLOW MAP:

1) pnpm ops:* command surface

- Flow A — `pnpm ops:full-cycle` (`scripts/run_full_cycle.ts` -> `runCanonicalFullCycle`)
  - ENTRY: CLI
  - CONTROL PLANE: no
  - BACKBONE: yes (`runAutonomousOperations` inside full-cycle)
  - WORKER: no (in-process execution of pipeline library functions)
  - LEARNING HUB: yes (via backbone stages and learning writers)
  - OUTPUT: DB mutations + audit + JSON result
  - Classification: partially canonical

- Flow B — `pnpm ops:autonomous [phase]` (`scripts/run_autonomous_operations.ts` -> `runAutonomousOperations`)
  - ENTRY: CLI
  - CONTROL PLANE: no
  - BACKBONE: yes
  - WORKER: no
  - LEARNING HUB: yes
  - OUTPUT: DB mutations + audit + JSON result
  - Classification: partially canonical

- Flow C — `pnpm ops:learning-refresh` (`scripts/run_learning_refresh.ts` -> `runContinuousLearningRefresh`)
  - ENTRY: CLI
  - CONTROL PLANE: no
  - BACKBONE: no
  - WORKER: optional (can also run as queued job)
  - LEARNING HUB: yes (direct)
  - OUTPUT: learning tables + scorecards + JSON
  - Classification: partially canonical

- Flow D — enqueue commands (`pnpm enqueue:supplier-discover|enqueue:profit-eval|enqueue:inventory-risk-scan|enqueue:listing-optimize`)
  - ENTRY: CLI
  - CONTROL PLANE: no
  - BACKBONE: no (except listing-optimize if used as substage elsewhere)
  - WORKER: yes (BullMQ job consumption)
  - LEARNING HUB: mixed (job-dependent)
  - OUTPUT: queue event -> worker mutation
  - Classification: partially canonical

2) worker startup and queue execution

- Flow E — `pnpm worker:jobs` (`src/workers/jobs.worker.ts`)
  - ENTRY: worker process boot
  - CONTROL PLANE: no
  - BACKBONE: yes for `AUTONOMOUS_OPS_BACKBONE` job; no for several other jobs
  - WORKER: yes (canonical consumer)
  - LEARNING HUB: mixed; explicit for `CONTINUOUS_LEARNING_REFRESH`, implicit/partial for other jobs
  - OUTPUT: job ledger + worker runs + audit + DB mutations
  - Classification: partially canonical

3) admin/control actions

- Flow F — `/api/admin/control/run-action` -> `runControlQuickAction`
  - ENTRY: control-plane UI action
  - CONTROL PLANE: yes
  - BACKBONE: yes for autonomous actions; no for order-sync and direct learning refresh
  - WORKER: mixed (inventory-risk action enqueues worker; others can run inline)
  - LEARNING HUB: yes for learning refresh and backbone paths
  - OUTPUT: redirect message + audit + runtime side effects
  - Classification: partially canonical

- Flow G — `/api/admin/pipeline/run-*` endpoints (supplier/marketplace/match/profit)
  - ENTRY: admin API
  - CONTROL PLANE: yes (admin operator surface)
  - BACKBONE: no
  - WORKER: yes (enqueue)
  - LEARNING HUB: indirect/mixed
  - OUTPUT: enqueue confirmation + audit
  - Classification: partially canonical

4) enqueue functions and generic queue API

- Flow H — typed enqueue helpers (`src/lib/jobs/enqueue*.ts`)
  - ENTRY: app route/script/library call
  - CONTROL PLANE: optional
  - BACKBONE: no
  - WORKER: yes
  - LEARNING HUB: mixed
  - OUTPUT: BullMQ job + job ledger
  - Classification: partially canonical

- Flow I — generic queue endpoint `/api/queue/enqueue`
  - ENTRY: API caller with pipeline-admin auth
  - CONTROL PLANE: no (generic API)
  - BACKBONE: no
  - WORKER: no (retired surface, no enqueue path)
  - LEARNING HUB: no
  - OUTPUT: hard-blocked canonical enforcement violation (`GENERIC_ENQUEUE_SURFACE_RETIRED`)
  - Classification: retired / blocked

5) remaining script execution paths

- Flow J — direct runtime scripts (`run_profit_engine_direct.ts`, `run_marketplace_scan_direct.ts`, `run_product_matcher_direct.ts`, `run_single_listing_publish.ts`, `run_listing_prepare_direct.ts`, etc.)
  - ENTRY: script CLI
  - CONTROL PLANE: no
  - BACKBONE: mostly no
  - WORKER: bypassed (calls runtime libraries directly)
  - LEARNING HUB: inconsistent
  - OUTPUT: direct mutation/publish behavior
  - Classification: non-canonical

- Flow K — direct/repair mutation scripts (`mutate_*`, `apply_sql_file.ts`, `approve_*`, `promote_*`, etc.)
  - ENTRY: script CLI
  - CONTROL PLANE: no
  - BACKBONE: no
  - WORKER: no
  - LEARNING HUB: no or inconsistent
  - OUTPUT: direct DB mutation
  - Classification: non-canonical (engineering-only; currently runtime-accessible)

Required classification summary:
- canonical: queue worker processing itself (`jobs.worker` consume path) and control-plane overview read path
- partially canonical: ops CLI, control actions, typed enqueue helpers, pipeline run APIs
- non-canonical: direct mutation/direct runtime scripts

GENERIC ENQUEUE SURFACE AUDIT (Phase 3):

| Caller path | Submitted job/action | Current purpose | Replacement exists? | Risk level |
|---|---|---|---|---|
| `src/app/api/queue/enqueue/route.ts` external pipeline-admin caller | Arbitrary `name` + `payload` job enqueue | Legacy generic queue submit surface | Yes (`/api/admin/control/run-action`, `/api/admin/pipeline/run-*`, explicit `enqueue*` wrappers) | CRITICAL |
| `src/*` internal callers | None found (no in-repo route/script caller references `/api/queue/enqueue`) | N/A | Yes | LOW |
| Hidden/non-admin callers | Potential external client only (pipeline-admin auth required) | Not discoverable in repo; governance ambiguity existed by design | Yes | HIGH |

Policy ambiguity removed in Phase 3:
- Generic job-name submission governance is retired.
- Control-plane submission is action-keyed and wrapper-backed only.
- Unknown submission attempts are hard-blocked and emitted as `CANONICAL_ENFORCEMENT_BLOCKED`.

ENFORCEMENT GAPS:

1) Control plane bypass / direct execution
- Location: `scripts/run_profit_engine_direct.ts`, `scripts/run_marketplace_scan_direct.ts`, `scripts/run_product_matcher_direct.ts`, `scripts/run_single_listing_publish.ts`, `scripts/run_listing_prepare_direct.ts`
- Violation: direct runtime execution bypasses control-plane governance and canonical queue orchestration
- Risk: CRITICAL
- Exact path: CLI script -> runtime library -> DB/publish side effects

2) Queue bypass for mutable stages
- Location: `scripts/run_autonomous_operations.ts`, `scripts/run_full_cycle.ts`, `runControlQuickAction` actions (`autonomous-*`, `learning-refresh`, `order-sync`)
- Violation: mutable operations execute inline without worker mediation
- Risk: HIGH
- Exact path: control/CLI entry -> backbone/library -> DB mutation directly

3) Generic arbitrary enqueue surface
- Location: `src/app/api/queue/enqueue/route.ts`
- Prior violation (before Phase 3): broad job submission endpoint could enqueue multiple job types without control-plane action-level policy
- Current status: retired with explicit hard block + canonical violation audit visibility
- Residual risk: LOW (legacy external callers now fail-closed)
- Exact path now: API -> `CANONICAL_ENFORCEMENT_BLOCKED` audit -> HTTP 410

4) Learning Hub enforcement not mandatory on all mutation paths
- Location: direct scripts and some queue jobs that mutate pipeline state but do not gate on learning freshness before mutation
- Violation: mutation paths can execute without explicit freshness gate/read requirement
- Risk: CRITICAL
- Exact path: script/route -> mutation stage -> no mandatory freshness validation

5) Snapshot/price/inventory guard consistency
- Location: publish worker has guards; non-worker paths can still mutate candidate/listing state through repair scripts or direct functions
- Violation: guard stack strongest in `listingExecute.worker`, weaker outside publish worker
- Risk: CRITICAL for publish/mutation integrity
- Exact path: direct script/update -> DB mutation without full publish guard stack

6) Direct DB mutation outside canonical runtime
- Location: `scripts/mutate_*`, `scripts/apply_sql_file.ts`, `scripts/approve_*`, `scripts/promote_*`, `scripts/fix_*`, `scripts/backfill_*`
- Violation: mutation guard checks environment safety, but not canonical orchestration requirements
- Risk: HIGH
- Exact path: script -> SQL update/DDL -> state mutation

CRITICAL RISKS:

- Publish sovereignty erosion: direct publish and readiness scripts can execute outside control-plane + queue policy, creating divergent safety posture.
- Learning drift amplification: missing mandatory freshness gate on mutation paths allows stale intelligence to drive listing/candidate mutations.
- Policy fragmentation: guardrails (price/snapshot/inventory) are concentrated in worker publish path, while side scripts mutate related state without equivalent enforcement.
- Operational ambiguity: operators can trigger similar outcomes through multiple entrypoints, undermining deterministic incident response.

ENFORCEMENT DESIGN:

1) Sovereign entry gate (minimal shared guard, no new deep abstraction)
- Where: entry layer (scripts + mutable API routes)
- How: central `assertCanonicalExecutionPath` utility with mode flags
- Enforcement:
  - HARD BLOCK for direct mutation/publish scripts in production mode
  - REDIRECT to canonical command/endpoint message for allowed ops
- Failure surfacing: return structured JSON/HTTP error and control-plane alert row (audit event `CANONICAL_PATH_BLOCKED`)

2) Control plane action policy map
- Where: `runControlQuickAction` and mutable admin routes
- How: explicit allowlist matrix: action -> required execution mode (`queue_worker` | `backbone_inline_readonly` | `learning_only`)
- Enforcement:
  - VALIDATION + HARD BLOCK for disallowed mode/action combinations
  - REDIRECT inline mutable actions into enqueue to worker-backed jobs where possible
- Failure surfacing: redirect with explicit error code + audit event + control-plane visible alert card

3) Queue sovereignty hardening
- Where: `/api/queue/enqueue/route.ts`
- How: retire generic free-form submission and enforce hard-block
- Enforcement:
  - HARD BLOCK all submissions on this route
  - ACTION-KEYED model remains available only through explicit control-plane wrappers/routes
- Failure surfacing: 410 with structured reason + audit `CANONICAL_ENFORCEMENT_BLOCKED` record for control-plane visibility

4) Learning Hub mandatory gate for mutation paths
- Where: shared pre-mutation validator used by backbone stage mutators + publish/approve/promote operations
- How: check freshness contract (`staleDomainCount`, required domains, pause reasons)
- Enforcement:
  - VALIDATION fail-close on stale/missing critical domains for publish/candidate decision mutations
  - OBSERVABILITY-only for non-mutating diagnostics
- Failure surfacing: explicit reason codes returned to caller and persisted to audit/control-plane status

5) Guard parity contract for publish-adjacent mutations
- Where: listing/candidate mutation entrypoints (review decision, promote-ready, publish scripts)
- How: require a preflight bundle (snapshot validity + price guard + inventory risk)
- Enforcement:
  - HARD BLOCK for publish and ready-to-publish promotion if any critical guard unresolved
  - REDIRECT to refresh jobs when stale data is detected
- Failure surfacing: actionable error with queued remediation job IDs

6) Legacy script containment
- Where: direct scripts under `scripts/run_*_direct*`, `scripts/promote_*`, `scripts/approve_*`, `scripts/run_single_listing_publish.ts`
- How: default to diagnostics-only mode unless `CANONICAL_OVERRIDE_TOKEN` present and environment is non-production
- Enforcement:
  - HARD BLOCK for production mutation behavior
  - OBSERVABILITY for diagnostic reads
- Failure surfacing: stdout structured block + audit record

SYSTEM RULESET:
(THE SYSTEM LAW)

Allowed to execute:
- Read-only diagnostics from canonical scripts and control-plane APIs.
- Queue-backed jobs through typed enqueue helpers or control-plane-approved actions.
- Worker-consumed jobs defined in canonical job names.

Blocked:
- Production direct mutation/publish from engineering scripts.
- Generic arbitrary job enqueue not mapped to approved control-plane action policy.
- Mutation execution when Learning Hub freshness contract is stale for required domains.

Must go through worker:
- Publish execution
- Listing prepare that changes publishable state
- Profit/match/marketplace/supplier refresh stages in production mutable mode
- Inventory risk, order sync, tracking sync, auto-purchase mutations

Must go through Learning Hub:
- Any state transition that marks candidate/listing as publish-eligible, ready_to_publish, active, or approved.
- Any mutation that changes risk posture or confidence labels.

Must go through control plane:
- Human-triggered operational mutations and queue dispatches.
- Override or repair actions (with explicit audit reason and surfaced status).

MIGRATION PLAN:

1) CRITICAL unsafe paths (publish + direct mutation)
- Change: hard-block production mutation behavior in direct publish/mutation scripts; emit redirect instructions to canonical control/queue actions.
- Failure visibility: immediate CLI/API error + audit `CANONICAL_PATH_BLOCKED` + control-plane alert.
- Rollback safety: env flag to temporarily permit legacy behavior in emergency (time-bounded, audited).

2) Learning Hub bypasses
- Change: add mandatory freshness validator before publish-eligibility, approve/promote, and publish execution.
- Failure visibility: explicit `LEARNING_FRESHNESS_BLOCK` reason with required domains listed.
- Rollback safety: staged rollout (warn -> block), threshold config in control-plane settings.

3) Control plane bypasses
- Change: route mutable operator actions through explicit action policy + queue dispatch; deprecate inline mutation actions.
- Failure visibility: action-level blocked reason in UI redirect and audit log.
- Rollback safety: per-action fallback toggle to previous behavior while monitoring.

4) Direct execution paths
- Change: convert retained direct scripts to diagnostics-only by default and require non-prod override token for mutation.
- Failure visibility: deterministic blocked output and incident tag.
- Rollback safety: one global break-glass toggle plus per-script override, all auditable.

5) Remaining partial paths
- Change: unify enqueue provenance schema + job allowlist checks; enforce guard parity across mutation entrypoints.
- Failure visibility: structured validation errors and queue audit trail.
- Rollback safety: deploy in monitor mode first, then fail-close once false-positive rate is acceptable.

QUESTION TO HUB:
Should canonical sovereignty require that *all* mutable control actions become queue-only (no inline mutation execution at all), or do we retain a narrow inline exception set for emergency recovery with mandatory dual-audit and Learning Hub freshness checks?
