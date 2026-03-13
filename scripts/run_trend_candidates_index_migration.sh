#!/usr/bin/env bash
set -euo pipefail
source scripts/lib/preflightMutation.sh
require_mutation_preflight "run_trend_candidates_index_migration.sh"
node scripts/mutate_execute_sql_file.mjs migrations/20260306_trend_candidates_dedupe_index.sql
