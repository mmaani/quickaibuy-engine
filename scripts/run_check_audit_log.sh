#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] run_check_audit_log.sh is deprecated. Use node scripts/check_audit_log.mjs instead." >&2

node scripts/check_audit_log.mjs
