const DIRECT_COUNTRY_MAP: Record<string, string> = {
  CN: "CN",
  US: "US",
  TR: "TR",
  GB: "GB",
  HK: "HK",
  JO: "JO",
  DE: "DE",
  AU: "AU",
};

const COUNTRY_SYNONYMS: Record<string, string> = {
  china: "CN",
  "people's republic of china": "CN",
  prc: "CN",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  us: "US",
  turkey: "TR",
  turkiye: "TR",
  "united kingdom": "GB",
  uk: "GB",
  britain: "GB",
  "great britain": "GB",
  "hong kong": "HK",
  jordan: "JO",
  germany: "DE",
  australia: "AU",
};

export function normalizeWarehouseCountry(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (DIRECT_COUNTRY_MAP[upper]) return DIRECT_COUNTRY_MAP[upper];

  const normalizedKey = trimmed.toLowerCase().replace(/\s+/g, " ");
  return COUNTRY_SYNONYMS[normalizedKey] ?? null;
}
