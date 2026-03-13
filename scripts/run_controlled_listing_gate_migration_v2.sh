#!/usr/bin/env bash
set -euo pipefail
source scripts/lib/preflightMutation.sh
require_mutation_preflight "run_controlled_listing_gate_migration_v2.sh"

cd /workspaces/quickaibuy-engine

DOTENV_CONFIG_PATH=.env.local node --import dotenv/config --import tsx scripts/mutate_execute_sql_file.mjs migrations/20260309a_normalize_listing_statuses_for_gate.sql
DOTENV_CONFIG_PATH=.env.local node --import dotenv/config --import tsx scripts/mutate_execute_sql_file.mjs migrations/20260309_controlled_listing_gate_v1.sql
