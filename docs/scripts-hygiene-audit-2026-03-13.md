THREAD:
Scripts Hygiene Audit

GOAL:
Review QuickAIBuy scripts quality, risk, and operational clarity.

FILES REVIEWED:
- `scripts/*` (top-level script inventory; risk-tiered deep pass).
- `scripts/workers/*` (worker-side check helpers).
- `scripts/lib/*` (shared diagnostics helpers).
- Related docs: `docs/operator-runbook.md`, `docs/runtime-diagnostics.md`.

RESULT:
The scripts surface is functionally rich but governance-light: it enables fast ops/debugging, yet naming drift and wrapper duplication create meaningful operator risk. The highest risk is not script correctness alone; it is ambiguous command choice under pressure (multiple variants for similar intents, plus state-changing scripts that look like checks).

RISK CLASSIFICATION:
- high risk scripts:
  - **DB mutation / state change**: `approve_profitable_candidate.ts`, `reject_profitable_candidate.ts`, `promote_listing_previews_ready.ts`, `promote_single_listing_ready.ts`, `prepare_one_ready_to_publish.ts`, `cleanup_stale_publish_in_progress.ts`, `reclassify_legacy_dry_run_active_listings.ts`, `refresh_listing_price_guard_readiness.ts`, `fix_single_listing_payload_for_retry.ts`, `backfill_*`, `patch_marketplace_scan_summary_labels*.py`, `run_sql_file.mjs`.
  - **Queue mutation / job removal**: `enqueue_*.ts`, `remove_supplier_discover_job.ts`.
  - **Migration runners**: `run_migration.sh`, `run_matches_migration.sh`, `run_trend_candidates_migration.sh`, `run_trend_candidates_index_migration.sh`, `run_controlled_listing_gate_migration*.sh`.
  - **Publish/listing direct runtime actions**: `publish_one_ready_listing.ts`, `run_single_listing_publish.ts`, `run_first_guarded_live_publish.ts`, `run_listing_execution_direct.ts`, `run_listing_prepare_direct.ts`.

- medium risk scripts:
  - **Read-only runtime/queue diagnostics**: `check_*` family (publish, listing lifecycle, order automation, queue, migrations, env checks).
  - **Worker/direct execution helpers**: `run_*_direct.ts` scripts that execute operational paths without mutating schema.
  - **Monitoring dashboards**: `monitor_pipeline.mjs`, `pipeline_dashboard.mjs`, `check_monitoring_dashboard_v1.sh`, `queue_namespace_diagnostics.ts`.

- low risk scripts:
  - **Debug/inspection probes**: `debug_*`, `inspect_*`, `peek-products-raw.mjs`, `review_matches.mjs`, `db_inspect.mjs`.
  - **Local utility/setup wrappers**: `find_db_file.sh`, `make_*_dirs.sh`, `install_psql.sh`, `update_repo_tree.mjs`, `watch_repo_tree.mjs`.

DUPLICATION / CONFUSION:
- Multiple wrapper layers for same check intent:
  - `check_*.mjs` + `run_check_*.sh` duplicates; both are runnable but canonical entrypoint is unclear.
- Versioned variants without explicit deprecation:
  - `run_controlled_listing_gate_migration.sh`, `_v2.sh`, `_v3.sh`.
  - `patch_marketplace_scan_summary_labels.py`, `_v2.py`, `_v3.py`.
  - `run_marketplace_scan_monitoring.ts` and `_latest.ts`.
  - `check_matches.mjs` vs `check_matches_latest.mjs`.
- Naming mismatch between behavior and perceived safety:
  - `push_pipeline_to_main.sh` performs `git add .`, commit, and push to `main` (very high-impact behavior behind generic “push pipeline” label).
  - `cleanup_stale_publish_in_progress.ts` mutates listing states but could be mistaken for harmless cleanup.
  - `run_sql_file.mjs` executes arbitrary SQL file content; generic name hides severity.
- Mixed environment mutation scripts (`pull_vercel_env.sh`, `sync_env_from_vercel_and_verify.sh`, `fix_env_local_missing.sh`) with overlapping outcomes and no clear canonical one.

DANGEROUS SCRIPTS:
- `scripts/push_pipeline_to_main.sh`:
  - Stages all files, commits, and pushes `HEAD:main`; easy to misuse and bypass normal review flow.
- `scripts/run_sql_file.mjs`:
  - Executes arbitrary SQL against configured DB with no dry-run or guardrail prompts.
- `scripts/run_migration.sh` and `scripts/run_controlled_listing_gate_migration*.sh`:
  - Production-impact schema/data changes; multiple versions increase wrong-target risk.
- `scripts/publish_one_ready_listing.ts` / `scripts/run_single_listing_publish.ts` / `scripts/run_first_guarded_live_publish.ts`:
  - Can trigger live listing behavior depending on env flags.
- `scripts/remove_supplier_discover_job.ts`:
  - Deletes queue jobs by ID; useful but hazardous without explicit operator intent checks.

CANONICALIZATION RECOMMENDATIONS:
- Standardize naming contract and enforce via lint/check script:
  - `check_*`: read-only diagnostics only.
  - `enqueue_*`: queue mutation only.
  - `run_*`: runtime execution wrappers (no schema mutation unless suffix indicates).
  - `mutate_*`: explicit DB state mutations (rename current mutation scripts into this family).
  - `migrate_*`: migration runners only.
  - `debug_*` / `inspect_*`: ad hoc probes, non-canonical.
- Canonical command map (single preferred script per intent):
  - listing publish sanity: one canonical guarded command (recommend `run_first_guarded_live_publish.ts`) and de-emphasize near-duplicates.
  - marketplace monitor: one canonical script (keep non-`_latest` and retire `_latest`).
  - matching checks: choose one (`check_matches_latest.mjs` preferred if business intent is latest-best; otherwise rename to explicit “top_confidence”).
  - migration flow: one canonical migration launcher with explicit migration argument + environment guard.

DEPRECATION RECOMMENDATIONS:
- Deprecate/alias duplicate wrappers:
  - `run_check_*.sh` wrappers where direct `check_*` script exists (keep at most one orchestrator).
- Retire versioned variants after cutover window:
  - `run_controlled_listing_gate_migration_v2.sh`, `_v3.sh` → merge into one parameterized `migrate_controlled_listing_gate.sh`.
  - `patch_marketplace_scan_summary_labels_v2.py`, `_v3.py` → one idempotent canonical patch script.
  - `run_marketplace_scan_monitoring_latest.ts` → canonical non-suffixed monitor command.
- Rename hazardous state changers for clarity:
  - `cleanup_stale_publish_in_progress.ts` → `mutate_listings_mark_stale_publish_failed.ts`.
  - `run_sql_file.mjs` → `mutate_execute_sql_file.mjs` (with guardrails).

README / INDEX RECOMMENDATION:
- Add `scripts/README.md` with one table per script containing:
  - script name,
  - intent category (`check/enqueue/run/mutate/migrate/debug`),
  - risk level (HIGH/MEDIUM/LOW),
  - prod-safe (`yes/no/guarded`),
  - owner thread/team,
  - prerequisites (`env`, `db`, `redis`, `vercel`),
  - side effects summary,
  - canonical replacement (if deprecated).
- Add “Golden commands” section (top 10 operational commands operators should use first).
- Add “Do not run in prod without approval” block listing all HIGH-risk mutate/migrate scripts.

TOP PRIORITY FIXES:
1. Create `scripts/README.md` index with risk + prod-safe metadata and canonical command mapping.
2. Freeze and deprecate version-suffixed duplicates (`*_v2`, `*_v3`, `*_latest`) in favor of one canonical entrypoint each.
3. Rename high-impact ambiguous scripts (`run_sql_file.mjs`, `cleanup_stale_publish_in_progress.ts`, `push_pipeline_to_main.sh`) to explicit-risk names.
4. Add preflight guardrails for HIGH-risk scripts (confirm target DB, environment banner, `--force` flag requirement).
5. Add CI check that rejects new scripts without index metadata and intent prefix compliance.

QUESTION TO HUB:
Which script-governance fix should be done first before further scale-up?
- **Answer:** ship `scripts/README.md` + canonical command map first. It immediately reduces operator error probability across all existing scripts without requiring broad script rewrites.
