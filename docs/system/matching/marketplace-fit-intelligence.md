# Marketplace-Fit Intelligence

Summary: Marketplace-fit intelligence learns what categories and product profiles publish cleanly on a marketplace, starting with eBay.

## Purpose
- Track category success and failure on eBay.
- Measure item-specific completeness by category.
- Track shipping transparency and ship-from normalization readiness.
- Preserve common failure signatures and policy-sensitive patterns.

## Inputs
- `matches`
- `marketplace_prices`
- `profitable_candidates`
- `listings`
- Product-market intelligence taxonomy

## Outputs
- Category-level eBay fit scores
- Publish success ratios
- Item-specific completeness ratios
- Shipping transparency ratios
- Ship-from normalization ratios
- Policy-sensitive ratios
- Failure signatures by category

## Feedback Loop
- Better publish success raises fit.
- Payload failure signatures and policy-sensitive attributes lower fit.
- The model only scores categories with actual evidence; missing evidence stays low-confidence rather than fabricated.

## Fail-Closed
- Marketplace-fit can deprioritize and prioritize.
- Marketplace-fit cannot bypass match confidence, linkage, stock, shipping, or profit safety.
