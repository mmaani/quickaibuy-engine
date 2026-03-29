# AI Evals and Labeling

Summary: Programmatic labels + structured eval capture quality gaps between predicted and observed outcomes without overriding safety gates.

## Pattern
1. Record predicted label/confidence.
2. Record observed outcome later.
3. Compute quality gap.
4. Reuse gaps for ranking and prioritization.

## Boundaries
- AI is advisory and scoring-oriented.
- No AI safety override of stock/shipping/profit fail-closed gates.
