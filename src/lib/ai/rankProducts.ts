export type RankableProduct = {
  candidateId: string;
  supplierTitle: string | null;
  estimatedProfit: unknown;
  marginPct: unknown;
  roiPct: unknown;
  matchConfidence: unknown;
  marketplaceTitle: string | null;
  supplierRawPayload: unknown;
};

type SellerTrustProfile = {
  feedbackScore: number | null;
  policyRiskTolerance: "low" | "medium" | "high";
};

function cleanText(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase();
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function countMediaSignals(rawPayload: unknown): number {
  const payload = objectOrNull(rawPayload);
  if (!payload) return 0;
  const images = Array.isArray(payload.images) ? payload.images.length : 0;
  const videos = Array.isArray(payload.videos) ? payload.videos.length : 0;
  return images + videos;
}

function riskPenalty(title: string, feedbackScore: number): number {
  const riskyKeywords = ["medical", "battery", "electric", "chemical", "supplement", "drone", "repair"];
  const isRisky = riskyKeywords.some((keyword) => title.includes(keyword));
  if (!isRisky) return 0;
  if (feedbackScore < 100) return 22;
  if (feedbackScore < 500) return 12;
  return 6;
}

export function rankProducts<T extends RankableProduct>(products: T[], sellerProfile: SellerTrustProfile): T[] {
  const feedbackScore = Number.isFinite(Number(sellerProfile.feedbackScore)) ? Number(sellerProfile.feedbackScore) : 0;

  const ranked = products
    .map((product) => {
      const title = cleanText(`${product.supplierTitle ?? ""} ${product.marketplaceTitle ?? ""}`);
      const visualScore = Math.min(12, countMediaSignals(product.supplierRawPayload) * 2);
      const simplicityBonus = /(decor|home|gift|organizer|lamp|light|storage)/.test(title) ? 8 : 0;
      const technicalPenalty = /(adapter|ic|motherboard|driver|diagnostic|firmware)/.test(title) ? 8 : 0;
      const trustPenalty = riskPenalty(title, feedbackScore);
      const matchComponent = Math.max(0, Math.min(1, Number(product.matchConfidence ?? 0))) * 25;
      const profitComponent = Math.max(0, Number(product.estimatedProfit ?? 0)) * 0.4;
      const marginComponent = Math.max(0, Number(product.marginPct ?? 0)) * 0.25;
      const roiComponent = Math.max(0, Number(product.roiPct ?? 0)) * 0.12;

      const score =
        matchComponent + profitComponent + marginComponent + roiComponent + visualScore + simplicityBonus - technicalPenalty - trustPenalty;

      return { product, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.product);

  return ranked;
}
