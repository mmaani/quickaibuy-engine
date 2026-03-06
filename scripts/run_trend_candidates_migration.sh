#!/usr/bin/env bash
set -euo pipefail
node scripts/run_sql_file.mjs migrations/20260306_add_normalized_candidate_to_trend_candidates.sql
