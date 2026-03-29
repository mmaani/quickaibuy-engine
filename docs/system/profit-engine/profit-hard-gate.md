# Profit Hard Gate

Summary: Profit hard-gate applies conservative, fail-closed blocking when expected economics or evidence confidence are insufficient.

## Inputs
COGS, shipping, fees, confidence/risk flags.

## Semantics
- allow only when profitability and evidence thresholds are met
- block if uncertain, stale, or below floor
