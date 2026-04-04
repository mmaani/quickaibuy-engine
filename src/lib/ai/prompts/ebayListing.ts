import { LISTING_SPECIFIC_KEYS } from "../schemas";

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
    "Do not hallucinate technical specs or compatibility claims.",
    "item_specifics must only use these keys:",
    LISTING_SPECIFIC_KEYS.join(", "),
    "Set unsupported or unknown values to null.",
    "For low-feedback seller profiles, use safer wording and avoid risky electronics framing unless clearly supported by evidence.",
    "When CJ proof-state or CJ runtime fields are present, treat them as canonical upstream truth.",
    "Do not imply purchase safety or orderability when CJ order-create proof is missing, limited, or blocked.",
    "Prefer proven CJ freight and runtime data over portal warning text or optimistic assumptions.",
    "Use marketplace evidence + supplier facts.",
    "Set review_required=true when confidence is low or any risk exists.",
    "confidence fields must be decimals 0..1.",
    "\nInput payload:",
    JSON.stringify(input),
  ].join("\n");
}
