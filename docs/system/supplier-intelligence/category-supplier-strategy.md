# Category Supplier Strategy

Summary: Category-supplier strategy combines supplier reliability learning with category/profile opportunity signals so the next supplier wave is biased toward the strongest supplier-marketplace-category combinations.

## Purpose
- Avoid over-concentrating on a single weak supplier.
- Prefer CJ/Temu-first composition when the evidence supports those suppliers on eBay.
- Reduce spend on paused or low-opportunity categories and profiles.

## Inputs
- Supplier reliability features
- Product-market category and profile opportunity scores
- Supplier-marketplace combo scores
- Discovery keyword taxonomy mapping

## Outputs
- Supplier-wave search limit boosts
- Keyword prioritization
- Early filter hints for weak profiles
- Stronger supplier-marketplace composition

## What Is Automated
- Discovery keyword ordering
- Supplier-wave search allocation
- Early deprioritization of weak categories/profiles

## What Remains Fail-Closed
- No supplier row is auto-approved for listing purely because its category scores well.
- Stock, shipping, linkage, and profit gates still decide progression.
