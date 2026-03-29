# Product Knowledge Graph

Summary: The product knowledge graph is the canonical derived model that links supplier products, matched marketplace listings, product concepts, category concepts, listing attributes, evidence quality, publish outcomes, and later market outcomes.

## Nodes
- Supplier product
- Marketplace listing
- Product concept
- Category concept
- Product profile
- Listing attributes
- Publish outcome
- Market outcome

## Retained Signals
- Normalized title and concept key
- Category cluster and use-case cluster
- Supplier mix and marketplace mix
- Attribute completeness
- Media quality
- Stock evidence quality
- Shipping evidence quality
- Match confidence
- Profit quality
- Publishability and publish outcome
- Order/click/impression outcomes where available
- Supplier reliability
- Parser metadata
- Freshness
- Blocked reasons

## Source of Truth
- Derived from canonical operational tables and learning features.
- No competing parallel persistence layer is introduced.
- Scorecards are recomputed from current truth instead of inventing synthetic state.

## Downstream Use
- Opportunity scoring
- Category strategy
- Product-profile strategy
- Marketplace-fit learning
- Attribute prioritization
- Supplier-wave guidance
