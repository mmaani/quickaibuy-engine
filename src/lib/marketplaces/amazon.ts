import type { MarketplaceCandidate } from "./ebay";

export async function searchAmazon(
  _query: string,
  _limit?: number
): Promise<MarketplaceCandidate[]> {
  void _query;
  void _limit;
  return [];
}
