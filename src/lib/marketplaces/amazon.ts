import type { MarketplaceCandidate } from "./ebay";

export async function searchAmazon(): Promise<MarketplaceCandidate[]> {
  throw new Error("Amazon marketplace scan is not implemented.");
}
