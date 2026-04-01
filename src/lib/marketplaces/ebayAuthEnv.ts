function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveEbayRefreshTokenCandidate(): {
  value: string | null;
  source: "EBAY_REFRESH_TOKEN" | "EBAY_USER_REFRESH_TOKEN" | null;
  invalidSources: Array<"EBAY_REFRESH_TOKEN" | "EBAY_USER_REFRESH_TOKEN">;
} {
  const candidates: Array<{
    key: "EBAY_REFRESH_TOKEN" | "EBAY_USER_REFRESH_TOKEN";
    value: string | null;
  }> = [
    { key: "EBAY_REFRESH_TOKEN", value: stringOrNull(process.env.EBAY_REFRESH_TOKEN) },
    { key: "EBAY_USER_REFRESH_TOKEN", value: stringOrNull(process.env.EBAY_USER_REFRESH_TOKEN) },
  ];
  const invalidSources: Array<"EBAY_REFRESH_TOKEN" | "EBAY_USER_REFRESH_TOKEN"> = [];

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    if (candidate.value.length >= 20) {
      return {
        value: candidate.value,
        source: candidate.key,
        invalidSources,
      };
    }
    invalidSources.push(candidate.key);
  }

  return {
    value: null,
    source: null,
    invalidSources,
  };
}
