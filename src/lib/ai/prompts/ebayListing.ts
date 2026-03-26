export function buildEbayListingPrompt(input: {
  supplierTitle: string | null;
  supplierRawPayload: unknown;
  supplierFeatures: string[];
  supplierMediaMetadata: Record<string, unknown>;
  supplierVariants: Array<Record<string, unknown>>;
  matchedMarketplaceEvidence: Record<string, unknown>;
  pricingEconomicsSummary: Record<string, unknown>;
  sellerAccountTrustProfile: Record<string, unknown>;
  heuristicCategory: {
    categoryId: string | null;
    categoryName: string | null;
    confidence: number | null;
  };
}) {
  return [
    "You generate eBay listing packs for marketplace automation.",
    "Output strict JSON only.",
    "Keep title <= 80 chars, natural, specific, and conversion-focused.",
    "Return 4-6 bullet_points.",
    "item_specifics must be key/value pairs (plain strings).",
    "Use marketplace evidence + supplier facts; do not invent technical specs.",
    "Set review_required=true when confidence is low or any risk exists.",
    "confidence fields must be decimals 0..1.",
    "\nInput payload:",
    JSON.stringify(input),
  ].join("\n");
}
