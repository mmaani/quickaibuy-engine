import type { VerifiedListingPackOutput } from "@/lib/ai/schemas";

type LiveListingSnapshot = {
  title: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  itemSpecifics?: Record<string, string | null> | null;
  description?: string | null;
};

export type ListingCorrectionDraft = {
  reviewRequired: true;
  autoApply: false;
  mismatchCount: number;
  mismatches: Array<{
    field: string;
    liveValue: string | null;
    verifiedValue: string | null;
    reason: string;
  }>;
  suggestedCorrections: Array<{
    field: string;
    from: string | null;
    to: string | null;
  }>;
  riskFlags: string[];
};

function normalizeValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function valuesDiffer(left: string | null, right: string | null): boolean {
  return (left ?? null) !== (right ?? null);
}

export function computeListingCorrectionDraft(input: {
  liveListing: LiveListingSnapshot;
  verifiedPack: VerifiedListingPackOutput;
}): ListingCorrectionDraft {
  const mismatches: ListingCorrectionDraft["mismatches"] = [];
  const suggestedCorrections: ListingCorrectionDraft["suggestedCorrections"] = [];
  const riskFlags = new Set<string>(input.verifiedPack.risk_flags);

  const pushMismatch = (field: string, liveValue: string | null, verifiedValue: string | null, reason: string) => {
    mismatches.push({ field, liveValue, verifiedValue, reason });
    suggestedCorrections.push({ field, from: liveValue, to: verifiedValue });
  };

  const liveTitle = normalizeValue(input.liveListing.title);
  const verifiedTitle = normalizeValue(input.verifiedPack.verified_title);
  if (valuesDiffer(liveTitle, verifiedTitle)) {
    pushMismatch("title", liveTitle, verifiedTitle, "live title diverges from verified preview");
    riskFlags.add("LIVE_TITLE_DRIFT");
  }

  const liveCategoryId = normalizeValue(input.liveListing.categoryId);
  const verifiedCategoryId = normalizeValue(input.verifiedPack.verified_category_id);
  if (valuesDiffer(liveCategoryId, verifiedCategoryId)) {
    pushMismatch("category_id", liveCategoryId, verifiedCategoryId, "live category differs from verified category");
    riskFlags.add("LIVE_CATEGORY_DRIFT");
  }

  const liveDescription = normalizeValue(input.liveListing.description);
  const verifiedDescription = normalizeValue(input.verifiedPack.verified_description);
  if (valuesDiffer(liveDescription, verifiedDescription)) {
    pushMismatch("description", liveDescription, verifiedDescription, "live description differs from verified preview");
    riskFlags.add("LIVE_DESCRIPTION_DRIFT");
  }

  const liveSpecifics = input.liveListing.itemSpecifics ?? {};
  for (const [key, verifiedValueRaw] of Object.entries(input.verifiedPack.verified_item_specifics)) {
    const verifiedValue = normalizeValue(verifiedValueRaw);
    const liveValue = normalizeValue(liveSpecifics[key] ?? null);
    if (!valuesDiffer(liveValue, verifiedValue)) continue;
    pushMismatch(`item_specifics.${key}`, liveValue, verifiedValue, "live item specific differs from verified preview");
    riskFlags.add("LIVE_ITEM_SPECIFICS_DRIFT");
  }

  return {
    reviewRequired: true,
    autoApply: false,
    mismatchCount: mismatches.length,
    mismatches,
    suggestedCorrections,
    riskFlags: Array.from(riskFlags),
  };
}
