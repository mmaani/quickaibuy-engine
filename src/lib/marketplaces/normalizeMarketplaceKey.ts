export type CanonicalMarketplaceKey = "amazon" | "ebay";

export function normalizeMarketplaceKey(input: string | null | undefined): string {
  const value = String(input ?? "").trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("amazon")) return "amazon";
  if (value.startsWith("ebay")) return "ebay";
  return value;
}

