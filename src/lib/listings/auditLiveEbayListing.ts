import type { ListingPackOutput, VerifiedListingPackOutput } from "@/lib/ai/schemas";
import { computeListingCorrectionDraft, type ListingCorrectionDraft } from "./computeListingCorrectionDraft";

type LiveEbayListingSnapshot = {
  listingId: string;
  title: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  description?: string | null;
  itemSpecifics?: Record<string, string | null> | null;
};

export type LiveEbayListingAuditResult = {
  listingId: string;
  auditStatus: "REVIEW_REQUIRED";
  manualApprovalRequired: true;
  auditScope: "POST_PUBLISH_RECOMMENDATION_ONLY";
  generatedPack: ListingPackOutput;
  verifiedPack: VerifiedListingPackOutput;
  correctionDraft: ListingCorrectionDraft;
};

export function auditLiveEbayListing(input: {
  liveListing: LiveEbayListingSnapshot;
  generatedPack: ListingPackOutput;
  verifiedPack: VerifiedListingPackOutput;
}): LiveEbayListingAuditResult {
  return {
    listingId: input.liveListing.listingId,
    auditStatus: "REVIEW_REQUIRED",
    manualApprovalRequired: true,
    auditScope: "POST_PUBLISH_RECOMMENDATION_ONLY",
    generatedPack: input.generatedPack,
    verifiedPack: input.verifiedPack,
    correctionDraft: computeListingCorrectionDraft({
      liveListing: input.liveListing,
      verifiedPack: input.verifiedPack,
    }),
  };
}
