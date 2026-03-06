#!/usr/bin/env bash
set -euo pipefail
node scripts/run_sql_file.mjs migrations/20260306_trend_candidates_dedupe_index.sql
