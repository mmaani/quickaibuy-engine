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
- Shipping transparency and ship-from-country resolution state
- Supplier account readiness constraints when an upstream account warning materially limits API/logistics quality

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
- Missing ship-from-country continues to block progression even when title match and price spread look strong.

## Current operator interpretation
- Prefer CJ/Temu-first only when supplier truth is actually stronger, not by policy default.
- Current CJ evidence is mixed: direct-product refresh now has a richer logistics fallback, but the account still shows an unverified portal warning and the strongest CJ candidate remains underwater.
- Current non-electronics priority is ambient-light / home-decor style products, especially donut-lamp variants, because they are producing stronger eBay fit than the stale CJ candidate.
- AliExpress remains commercially interesting in this category family, but progress still depends on deterministic origin evidence rather than more parser-only work.
