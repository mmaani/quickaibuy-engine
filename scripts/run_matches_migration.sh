#!/usr/bin/env bash
set -euo pipefail
source scripts/lib/preflightMutation.sh
require_mutation_preflight "run_matches_migration.sh"
node scripts/mutate_execute_sql_file.mjs migrations/20260307_create_matches.sql
