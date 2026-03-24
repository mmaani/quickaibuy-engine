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

Preview generation may still begin with reference-only supplier URLs, but the canonical v1 readiness path is now:
- ranked final image selection first
- EPS normalization second
- `READY_TO_PUBLISH` only after the final ordered set is EPS-only
- live publish/revise still re-validates EPS-only as the final boundary guard

QuickAIBuy v1 therefore enforces:
- final publish/revise payloads must use EPS-hosted images only
- mixed hosting modes are not allowed
- external and self-hosted image URLs are blocked at publish time
- source supplier image URLs remain provenance only and are not treated as final outgoing listing pictures once normalized

## EPS Normalization

QuickAIBuy normalizes only the final ranked image set, not every discovered supplier image.

Normalization requirements:
- source URLs must be valid HTTPS
- duplicate source URLs are removed before upload
- slot order is preserved exactly through normalization
- likely sub-500px images are blocked when the URL metadata makes that inferable
- repeated preview refreshes reuse cached EPS results when the source URL is unchanged

Operational note:
- QuickAIBuy v1 now defaults to the eBay Media API for image normalization from URL
- Trading `UploadSiteHostedPictures` remains temporary fallback-only behind explicit config
- `UploadSiteHostedPictures` is deprecated and scheduled for decommission on September 30, 2026
- the abstraction is intentionally narrow so Trading can be removed without rewriting the rest of listing readiness

## Assumptions

Because QuickAIBuy v1 does not fetch or analyze image binaries in the ranking step, the following are heuristic rather than pixel-verified:
- blur detection
- compression detection
- text density
- background cleanliness
- subject centering
- product fill percentage

These rules remain fail-closed through existing listing review and publish guards.
