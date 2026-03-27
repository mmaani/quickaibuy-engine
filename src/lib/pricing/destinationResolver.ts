import { normalizeMarketplaceKey } from "@/lib/marketplaces/normalizeMarketplaceKey";
import { getShippingConfig } from "@/lib/pricing/shippingConfig";

export function resolvePricingDestinationForMarketplace(marketplaceKey?: string | null): string {
  const normalized = normalizeMarketplaceKey(marketplaceKey ?? "ebay");
  const config = getShippingConfig();

  if (normalized === "ebay") {
    return config.defaultPricingDestination;
  }

  return config.defaultPricingDestination;
}
