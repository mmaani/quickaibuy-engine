#!/usr/bin/env bash
set -euo pipefail
psql "$DATABASE_URL" -f migrations/20260306_add_normalized_candidate_to_trend_candidates.sql
