#!/usr/bin/env bash
set -euo pipefail
source scripts/lib/preflightMutation.sh
require_mutation_preflight "run_migration.sh"
psql "$DATABASE_URL" -f migrations/20260306_add_normalized_candidate_to_trend_candidates.sql
