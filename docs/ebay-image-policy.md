# eBay Image Policy (v1)

## Scope

This policy applies to QuickAIBuy v1 eBay listing previews and eBay publish payload preparation only.

It does not change:
- approval gates
- publish gates
- price guard
- inventory guard
- marketplace scope

## Canonical Image Order

QuickAIBuy uses one required order for eBay listing images:

1. Slot 1: hero product image
2. Slots 2-4: alternate angles and core product details
3. Slots 5-6: scale, dimensions, or in-use context
4. Slots 7+: optional supporting images only when still high quality

## Hero Image Rule

Slot 1 must be the clearest product-first image available:
- bright and readable at mobile thumbnail size
- strongest product recognition
- centered subject when possible
- clean or low-distraction background preferred
- no collage or text-heavy creative

For lighting and decor products:
- the hero may include visible glow or ambience
- the product itself must still remain readable and recognizable

## Ranking Rules

Image ranking is deterministic and metadata-only in v1.

Signals currently use URL and media metadata heuristics only:
- inferred dimensions from URL tokens
- aspect ratio suitability
- clean-background hints
- subject-centering hints
- strong product-fill hints
- angle/detail/scale/lifestyle hints
- text-heavy penalty
- watermark penalty
- collage penalty
- screenshot penalty
- blur/compression-risk penalty from filename hints
- duplicate suppression by normalized URL and fingerprint

## Minimum Quality Rules

QuickAIBuy excludes images when:
- URL is broken or invalid
- watermark-heavy
- likely screenshot
- likely collage-heavy
- likely below eBay minimum image size when dimensions are inferable from the URL

If dimensions are inferable, the image must meet the eBay minimum of 500 pixels on the longest side.

## Product-Type Rules

Decor / lighting:
- keep one strong glow or ambience image
- do not let glow-only imagery displace a readable hero

Gadgets / tools:
- prefer one usage or scale image after core product views

Wearables / accessories:
- prefer one close-up detail image after core product views

Multi-part items:
- packaging/components images remain secondary and should not displace product-first views

## Hosting Rules

Preview generation may still use reference-only image URLs, but eBay live publish is fail-closed:
- final publish payload must use EPS-hosted images only
- mixed hosting modes are not allowed
- external and self-hosted image URLs are blocked at publish time

## Assumptions

Because QuickAIBuy v1 does not fetch or analyze image binaries in the ranking step, the following are heuristic rather than pixel-verified:
- blur detection
- compression detection
- text density
- background cleanliness
- subject centering
- product fill percentage

These rules remain fail-closed through existing listing review and publish guards.
