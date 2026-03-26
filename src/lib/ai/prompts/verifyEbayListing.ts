import { LISTING_SPECIFIC_KEYS } from "../schemas";

export function buildVerifyEbayListingPrompt(input: {
  generatedPack: Record<string, unknown>;
  supplierTitle: string | null;
  supplierFeatures: string[];
  supplierRawPayload: unknown;
  supplierMediaMetadata: Record<string, unknown>;
  matchedMarketplaceEvidence: Record<string, unknown>;
  pricingEconomicsSummary: Record<string, unknown>;
  heuristicCategory: {
    categoryId: string | null;
    categoryName: string | null;
    confidence: number | null;
    ruleLabel: string | null;
  };
  evidenceSummary: string[];
}) {
  return [
    "You verify and correct an AI-generated eBay listing pack.",
    "Output strict JSON only.",
    "Do not hallucinate.",
    "Only keep claims supported by the provided supplier payload, supplier features, image metadata, matched marketplace evidence, or heuristic category evidence.",
    "If a value is unsupported or uncertain, remove it or set it to null.",
    "review_required must remain true whenever uncertainty or risk exists.",
    "verified_title must be <= 80 chars.",
    "verified_item_specifics must only use these keys:",
    LISTING_SPECIFIC_KEYS.join(", "),
    "risk_flags should explain unresolved evidence or conflicts.",
    "corrected_fields should name fields you changed.",
    "removed_claims should list unsupported claims removed from title, bullets, description, or specifics.",
    "\nInput payload:",
    JSON.stringify(input),
  ].join("\n");
}
