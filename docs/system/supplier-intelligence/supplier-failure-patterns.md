# Supplier Failure Patterns

Summary: Supplier failure signatures are explicitly tracked and used to reduce unsafe/low-yield progression.

## Common patterns
- 429 pressure spikes
- exact-match-not-found repeats
- weak payload sparsity
- stale snapshot frequency

## Containment
Pattern-heavy suppliers are deprioritized for publish-critical paths and escalated for manual review.
