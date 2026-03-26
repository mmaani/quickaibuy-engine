import {
  applyEvidenceBackedListingCorrections,
  type VerifyListingPackInputShape,
} from "@/lib/ai/verifyListingPack";
import type { ListingPackOutput } from "@/lib/ai/schemas";
import { auditLiveEbayListing } from "@/lib/listings/auditLiveEbayListing";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const generatedPack: ListingPackOutput = {
  optimized_title: "Portable USB Fan Modern Leafless Mini Fan for Travel",
  category_id: "20612",
  category_name: "Portable Fans",
  bullet_points: [
    "Portable cooling for travel",
    "USB rechargeable design",
    "Leafless fan body",
    "Modern design",
  ],
  description: "Portable cooling with a modern design and USB charging.",
  item_specifics: {
    brand: null,
    type: "Leafless Fan",
    model: null,
    material: null,
    color: null,
    voltage: null,
    power: null,
    connectivity: "USB",
    room: null,
    use_case: "Portable Cooling",
    country_of_origin: "CN",
  },
  pricing_hint: "Competitive",
  trust_flags: [],
  review_required: true,
  confidence: {
    title: 0.84,
    category: 0.82,
    specifics: 0.71,
    overall: 0.8,
  },
};

const input: VerifyListingPackInputShape = {
  generatedPack,
  supplierTitle: "Whirlwind Leafless Fan USB Charging Portable Mini Fan",
  supplierFeatures: ["USB charging", "portable mini fan", "button control"],
  supplierRawPayload: {
    features: ["USB charging", "portable mini fan", "button control"],
    description: "Portable fan with USB charging and bladeless body",
  },
  supplierMediaMetadata: {
    imageCount: 7,
    selectedImageKinds: ["hero", "angle", "detail"],
  },
  matchedMarketplaceEvidence: {
    marketplaceTitle: "Whirlwind USB Portable Fan",
  },
  pricingEconomicsSummary: {
    estimatedProfit: 10,
  },
  heuristicCategory: {
    categoryId: "10034",
    categoryName: "Home & Garden > Home Decor > Other Home Decor",
    confidence: 0.9,
    ruleLabel: "desk-decor-safe",
  },
};

const rawVerifiedCandidate = {
  verified_title: "Portable USB Fan Modern Leafless Mini Fan for Travel",
  verified_category_id: "20612",
  verified_category_name: "Portable Fans",
  verified_bullet_points: [
    "Portable cooling for travel",
    "USB rechargeable design",
    "Modern design",
  ],
  verified_description: "Portable cooling with a modern design and USB charging.",
  verified_item_specifics: {
    brand: null,
    type: "Leafless Fan",
    model: null,
    material: null,
    color: null,
    voltage: null,
    power: null,
    connectivity: "USB",
    room: null,
    use_case: "Portable Cooling",
    country_of_origin: "CN",
  },
  removed_claims: [],
  corrected_fields: [],
  risk_flags: [],
  verification_confidence: 0.88,
  review_required: true,
};

const corrected = applyEvidenceBackedListingCorrections(rawVerifiedCandidate, input);
assert(corrected.ok, "corrected pack should validate");
assert(corrected.data.verified_item_specifics.use_case === null, "unsupported specific should be nulled");
assert(corrected.data.verified_item_specifics.country_of_origin === null, "unsupported origin should be nulled");
assert(
  corrected.data.corrected_fields.includes("verified_category_id"),
  "category conflict should record corrected field"
);
assert(
  corrected.data.verified_category_id === "10034",
  "strong classifier category should win on conflict"
);
assert(corrected.data.review_required === true, "review should remain required");

const audit = auditLiveEbayListing({
  liveListing: {
    listingId: "live-1",
    title: "Portable USB Fan Modern Leafless Mini Fan for Travel",
    categoryId: "20612",
    categoryName: "Portable Fans",
    description: "Portable cooling with a modern design and USB charging.",
    itemSpecifics: {
      connectivity: "USB",
      use_case: "Portable Cooling",
    },
  },
  generatedPack,
  verifiedPack: corrected.data,
});

assert(audit.auditStatus === "REVIEW_REQUIRED", "live audit must remain review only");
assert(audit.manualApprovalRequired === true, "manual approval must be required");
assert(audit.correctionDraft.autoApply === false, "live corrections must not auto-apply");
assert(audit.correctionDraft.mismatchCount >= 2, "audit should detect live drift against verified preview");
assert(
  audit.correctionDraft.mismatches.some((entry) => entry.field === "category_name"),
  "audit should detect category name drift"
);

const auditWithUnknowns = auditLiveEbayListing({
  liveListing: {
    listingId: "live-2",
    title: "Portable USB Fan Modern Leafless Mini Fan for Travel",
    categoryId: "10034",
    categoryName: null,
    description: null,
    itemSpecifics: {
      connectivity: null,
    },
  },
  generatedPack,
  verifiedPack: corrected.data,
});

assert(
  !auditWithUnknowns.correctionDraft.mismatches.some((entry) => entry.field === "category_name"),
  "unknown live category name should not create a false mismatch"
);
assert(
  !auditWithUnknowns.correctionDraft.mismatches.some((entry) => entry.field === "description"),
  "unknown live description should not create a false mismatch"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      correctedFields: corrected.data.corrected_fields,
      removedClaims: corrected.data.removed_claims,
      auditMismatchCount: audit.correctionDraft.mismatchCount,
      unknownFieldMismatchCount: auditWithUnknowns.correctionDraft.mismatchCount,
    },
    null,
    2
  )
);
