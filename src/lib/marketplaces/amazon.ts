import type { MarketplaceCandidate } from "./ebay";

export async function searchAmazon(
  _query: string,
  _limit = 10
): Promise<MarketplaceCandidate[]> {
  return [];
}
