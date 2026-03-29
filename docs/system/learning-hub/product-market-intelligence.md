# Product-Market Intelligence

Summary: Product-market intelligence is the canonical learning layer that turns supplier rows, matches, listing outcomes, and market feedback into category, product-profile, marketplace-fit, attribute, and opportunity scorecards.

## Purpose
- Identify the best categories and product profiles to pursue now.
- Deprioritize weak categories, weak profiles, and low-evidence supplier-marketplace combinations early.
- Feed explainable opportunity scores into supplier discovery, candidate filtering, review prioritization, and listing guidance.

## Inputs
- `products_raw`
- `marketplace_prices`
- `matches`
- `profitable_candidates`
- `listings`
- `order_items`
- `learning_features`

## Outputs
- Product knowledge graph nodes
- Category intelligence scorecards
- Product-profile intelligence scorecards
- eBay marketplace-fit scorecards
- Attribute intelligence scorecards
- Supplier-marketplace opportunity scorecards
- Explainable product opportunity rankings
- Discovery hints for stronger supplier-wave composition

## Feedback Loops
- Publishability and publish success raise category/profile confidence.
- Manual-review pressure, block reasons, and stale evidence raise failure and drift pressure.
- Orders, clicks, and impressions improve profile and marketplace-fit ranking when present.
- Supplier reliability learning still feeds the engine; this layer does not weaken stock, shipping, linkage, or profit gates.

## Control-Plane Surfacing
- `/dashboard`
- `/admin/control`
- Compact panels on review, listings, and orders admin routes through the canonical control-plane overview.

## Automation
- Supplier discovery keyword ordering and supplier-wave search limits
- Early category/profile filtering
- Review prioritization
- Listing guidance and attribute pressure visibility

## Fail-Closed Boundaries
- Shipping truth remains deterministic and fail-closed.
- Stock truth remains deterministic and fail-closed.
- Profit hard-gate remains canonical.
- Supplier linkage safety remains canonical.
- No auto-purchase.

## AI Boundaries
- AI is used for extraction, labeling, clustering, ranking, and recommendation only.
- The system does not fabricate demand, shipping truth, stock truth, conversion truth, or market performance.
