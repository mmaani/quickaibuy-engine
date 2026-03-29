# Shipping Intelligence

Summary: Shipping evidence is captured with confidence/freshness and blocks publish when unknown or weak.

## Core model
- shipping quote extraction and persistence
- confidence score and freshness timestamp
- destination-aware lookup

## Fail-closed behavior
If deterministic shipping is unavailable, candidates remain blocked from ready-to-publish progression.
