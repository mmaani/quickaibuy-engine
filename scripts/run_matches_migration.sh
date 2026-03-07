#!/usr/bin/env bash
set -euo pipefail
node scripts/run_sql_file.mjs migrations/20260307_create_matches.sql
