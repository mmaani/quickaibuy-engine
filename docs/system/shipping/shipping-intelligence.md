# Shipping Intelligence

Summary: Shipping evidence is captured with confidence/freshness and blocks publish when unknown or weak.

## Core model
- shipping quote extraction and persistence
- confidence score and freshness timestamp
- destination-aware lookup
- ship-from-country resolution and transparency state
- source attribution for the shipping evidence that won

## Current supplier behavior
- CJ direct-product refresh now prefers the richer `logistic/freightCalculateTip` response when it can build a valid SKU-based request.
- CJ falls back to the simpler `logistic/freightCalculate` path only when the richer quote cannot be produced.
- AliExpress still depends on deterministic supplier evidence in fetched pages; parser improvements alone do not guarantee ship-from-country truth.

## Fail-closed behavior
If deterministic shipping is unavailable, candidates remain blocked from ready-to-publish progression.

## Operator notes
- A strong title match and attractive marketplace spread are not enough if ship-from-country is still unresolved.
- Current non-electronics discovery leads remain blocked on this exact issue, so shipping truth recovery is still a first-class gate.
- Treat upstream supplier-account constraints as part of shipping quality when they materially affect logistics endpoint coverage or call reliability.
