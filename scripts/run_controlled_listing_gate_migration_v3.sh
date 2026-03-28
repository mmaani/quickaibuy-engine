#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/preflightMutation.sh
require_mutation_preflight "run_controlled_listing_gate_migration_v3.sh"

echo "[DEPRECATED] run_controlled_listing_gate_migration_v3.sh is deprecated. Use bash scripts/run_controlled_listing_gate_migration.sh instead." >&2

bash scripts/run_controlled_listing_gate_migration.sh
