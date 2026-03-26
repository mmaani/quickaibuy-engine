export type ListingPackTrustFlag =
  | "MATCH_LOW_CONFIDENCE"
  | "CATEGORY_LOW_CONFIDENCE"
  | "INSUFFICIENT_FEATURES"
  | "RISKY_PRODUCT"
  | "SELLER_ACCOUNT_LIMITED"
  | "PRICING_UNCERTAIN"
  | "SUPPLIER_PAYLOAD_SPARSE"
  | "MEDIA_QUALITY_LOW";

export const LISTING_SPECIFIC_KEYS = [
  "brand",
  "type",
  "model",
  "material",
  "color",
  "voltage",
  "power",
  "connectivity",
  "room",
  "use_case",
  "country_of_origin",
] as const;

export type ListingSpecificKey = (typeof LISTING_SPECIFIC_KEYS)[number];

export type ListingPackOutput = {
  optimized_title: string;
  category_id: string;
  category_name: string;
  bullet_points: string[];
  description: string;
  item_specifics: Record<ListingSpecificKey, string | null>;
  pricing_hint: string;
  trust_flags: ListingPackTrustFlag[];
  review_required: boolean;
  confidence: {
    title: number;
    category: number;
    specifics: number;
    overall: number;
  };
};

export type ListingPackValidation =
  | { ok: true; data: ListingPackOutput }
  | { ok: false; errors: string[] };

export type VerifiedListingPackOutput = {
  verified_title: string;
  verified_category_id: string;
  verified_category_name: string;
  verified_bullet_points: string[];
  verified_description: string;
  verified_item_specifics: Record<ListingSpecificKey, string | null>;
  removed_claims: string[];
  corrected_fields: string[];
  risk_flags: string[];
  verification_confidence: number;
  review_required: boolean;
};

export type VerifiedListingPackValidation =
  | { ok: true; data: VerifiedListingPackOutput }
  | { ok: false; errors: string[] };

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanSpecificValue(value: unknown): string | null {
  const cleaned = cleanString(value);
  return cleaned.length > 0 ? cleaned : null;
}

export const LISTING_PACK_LOW_CONFIDENCE_THRESHOLD = 0.8;

export function validateListingPackOutput(value: unknown): ListingPackValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["listing pack must be an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];

  const optimizedTitle = cleanString(record.optimized_title);
  if (!optimizedTitle) errors.push("optimized_title is required");
  if (optimizedTitle.length > 80) errors.push("optimized_title must be <= 80 chars");

  const categoryId = cleanString(record.category_id);
  if (!categoryId) errors.push("category_id is required");

  const categoryName = cleanString(record.category_name);
  if (!categoryName) errors.push("category_name is required");

  const bulletPointsRaw = Array.isArray(record.bullet_points) ? record.bullet_points : [];
  const bulletPoints = bulletPointsRaw
    .map((entry) => cleanString(entry))
    .filter((entry) => entry.length > 0)
    .slice(0, 8);
  if (bulletPoints.length < 3) errors.push("bullet_points must contain at least 3 entries");

  const description = cleanString(record.description);
  if (!description) errors.push("description is required");

  const specificsRaw =
    record.item_specifics && typeof record.item_specifics === "object" && !Array.isArray(record.item_specifics)
      ? (record.item_specifics as Record<string, unknown>)
      : null;

  const itemSpecifics = Object.fromEntries(
    LISTING_SPECIFIC_KEYS.map((key) => [key, null])
  ) as Record<ListingSpecificKey, string | null>;

  if (!specificsRaw) {
    errors.push("item_specifics must be an object");
  } else {
    for (const key of LISTING_SPECIFIC_KEYS) {
      itemSpecifics[key] = cleanSpecificValue(specificsRaw[key]);
    }
  }

  const populatedSpecificsCount = LISTING_SPECIFIC_KEYS.filter((key) => Boolean(itemSpecifics[key])).length;
  if (populatedSpecificsCount < 3) {
    errors.push("item_specifics must contain at least 3 non-null supported fields");
  }

  const pricingHint = cleanString(record.pricing_hint);
  if (!pricingHint) errors.push("pricing_hint is required");

  const allowedFlags = new Set<ListingPackTrustFlag>([
    "MATCH_LOW_CONFIDENCE",
    "CATEGORY_LOW_CONFIDENCE",
    "INSUFFICIENT_FEATURES",
    "RISKY_PRODUCT",
    "SELLER_ACCOUNT_LIMITED",
    "PRICING_UNCERTAIN",
    "SUPPLIER_PAYLOAD_SPARSE",
    "MEDIA_QUALITY_LOW",
  ]);
  const trustFlagsRaw = Array.isArray(record.trust_flags) ? record.trust_flags : [];
  const trustFlags = trustFlagsRaw
    .map((entry) => cleanString(entry))
    .filter((entry): entry is ListingPackTrustFlag => allowedFlags.has(entry as ListingPackTrustFlag));

  const confidenceRaw =
    record.confidence && typeof record.confidence === "object" && !Array.isArray(record.confidence)
      ? (record.confidence as Record<string, unknown>)
      : {};

  const confidence = {
    title: clampConfidence(confidenceRaw.title),
    category: clampConfidence(confidenceRaw.category),
    specifics: clampConfidence(confidenceRaw.specifics),
    overall: clampConfidence(confidenceRaw.overall),
  };

  const hasLowConfidence =
    confidence.overall < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD ||
    confidence.category < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD ||
    confidence.title < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD ||
    confidence.specifics < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD;

  const reviewRequired = Boolean(record.review_required) || hasLowConfidence;

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      optimized_title: optimizedTitle,
      category_id: categoryId,
      category_name: categoryName,
      bullet_points: bulletPoints,
      description,
      item_specifics: itemSpecifics,
      pricing_hint: pricingHint,
      trust_flags: trustFlags,
      review_required: reviewRequired,
      confidence,
    },
  };
}

export function validateVerifiedListingPackOutput(value: unknown): VerifiedListingPackValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["verified listing pack must be an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];

  const verifiedTitle = cleanString(record.verified_title);
  if (!verifiedTitle) errors.push("verified_title is required");
  if (verifiedTitle.length > 80) errors.push("verified_title must be <= 80 chars");

  const categoryId = cleanString(record.verified_category_id);
  if (!categoryId) errors.push("verified_category_id is required");

  const categoryName = cleanString(record.verified_category_name);
  if (!categoryName) errors.push("verified_category_name is required");

  const bulletPointsRaw = Array.isArray(record.verified_bullet_points) ? record.verified_bullet_points : [];
  const bulletPoints = bulletPointsRaw
    .map((entry) => cleanString(entry))
    .filter((entry) => entry.length > 0)
    .slice(0, 8);
  if (bulletPoints.length < 3) errors.push("verified_bullet_points must contain at least 3 entries");

  const description = cleanString(record.verified_description);
  if (!description) errors.push("verified_description is required");

  const specificsRaw =
    record.verified_item_specifics &&
    typeof record.verified_item_specifics === "object" &&
    !Array.isArray(record.verified_item_specifics)
      ? (record.verified_item_specifics as Record<string, unknown>)
      : null;

  const itemSpecifics = Object.fromEntries(
    LISTING_SPECIFIC_KEYS.map((key) => [key, null])
  ) as Record<ListingSpecificKey, string | null>;
  if (!specificsRaw) {
    errors.push("verified_item_specifics must be an object");
  } else {
    for (const key of LISTING_SPECIFIC_KEYS) {
      itemSpecifics[key] = cleanSpecificValue(specificsRaw[key]);
    }
  }

  const removedClaims = Array.isArray(record.removed_claims)
    ? record.removed_claims.map((entry) => cleanString(entry)).filter((entry) => entry.length > 0).slice(0, 20)
    : [];
  const correctedFields = Array.isArray(record.corrected_fields)
    ? record.corrected_fields.map((entry) => cleanString(entry)).filter((entry) => entry.length > 0).slice(0, 20)
    : [];
  const riskFlags = Array.isArray(record.risk_flags)
    ? record.risk_flags.map((entry) => cleanString(entry)).filter((entry) => entry.length > 0).slice(0, 20)
    : [];

  const verificationConfidence = clampConfidence(record.verification_confidence);
  const reviewRequired = Boolean(record.review_required) || verificationConfidence < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD;

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      verified_title: verifiedTitle,
      verified_category_id: categoryId,
      verified_category_name: categoryName,
      verified_bullet_points: bulletPoints,
      verified_description: description,
      verified_item_specifics: itemSpecifics,
      removed_claims: removedClaims,
      corrected_fields: correctedFields,
      risk_flags: riskFlags,
      verification_confidence: verificationConfidence,
      review_required: reviewRequired,
    },
  };
}
