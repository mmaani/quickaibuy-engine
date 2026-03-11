# Admin Control Panel (v1)

## Purpose

The admin control panel provides explicit operator controls for safety-critical QuickAIBuy workflows.

## Manual Override Controls

Supported overrides:
- `PAUSE_PUBLISHING`
- `PAUSE_MARKETPLACE_SCAN`
- `PAUSE_ORDER_SYNC`
- `EMERGENCY_READ_ONLY`

Overrides are incident-use only and all actions must be audited.

## Runbook Reference Surface (New)

Critical runbook procedures may be surfaced in admin at:

- `/admin/control/runbook`

v1 constraints:
- read-only informational guidance only
- no automated actions
- no implicit override toggles

Canonical procedures remain documented in `docs/operator-runbook.md`.
