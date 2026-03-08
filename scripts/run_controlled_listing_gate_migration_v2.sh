#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/quickaibuy-engine

DOTENV_CONFIG_PATH=.env.local node --import dotenv/config --import tsx scripts/run_sql_file.mjs migrations/20260309a_normalize_listing_statuses_for_gate.sql
DOTENV_CONFIG_PATH=.env.local node --import dotenv/config --import tsx scripts/run_sql_file.mjs migrations/20260309_controlled_listing_gate_v1.sql
