const COUNTRY_ALIASES: Array<{ code: string; patterns: RegExp[] }> = [
  { code: "US", patterns: [/\bUS\b/i, /\bUSA\b/i, /\bUNITED STATES\b/i, /\bAMERICA\b/i] },
  { code: "CN", patterns: [/\bCN\b/i, /\bCHINA\b/i] },
  { code: "GB", patterns: [/\bGB\b/i, /\bUK\b/i, /\bUNITED KINGDOM\b/i, /\bENGLAND\b/i] },
  { code: "DE", patterns: [/\bDE\b/i, /\bGERMANY\b/i] },
  { code: "PL", patterns: [/\bPL\b/i, /\bPOLAND\b/i] },
  { code: "CZ", patterns: [/\bCZ\b/i, /\bCZECH REPUBLIC\b/i, /\bCZECHIA\b/i] },
  { code: "ES", patterns: [/\bES\b/i, /\bSPAIN\b/i] },
  { code: "FR", patterns: [/\bFR\b/i, /\bFRANCE\b/i] },
  { code: "IT", patterns: [/\bIT\b/i, /\bITALY\b/i] },
  { code: "NL", patterns: [/\bNL\b/i, /\bNETHERLANDS\b/i, /\bHOLLAND\b/i] },
  { code: "BE", patterns: [/\bBE\b/i, /\bBELGIUM\b/i] },
  { code: "CA", patterns: [/\bCA\b/i, /\bCANADA\b/i] },
  { code: "MX", patterns: [/\bMX\b/i, /\bMEXICO\b/i] },
  { code: "AU", patterns: [/\bAU\b/i, /\bAUSTRALIA\b/i] },
  { code: "TR", patterns: [/\bTR\b/i, /\bTURKEY\b/i] },
];

function normalizeCompact(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeShipFromCountry(value: unknown): string | null {
  const normalized = normalizeCompact(value);
  if (!normalized) return null;
  if (/^[A-Z]{2}$/.test(normalized)) {
    return COUNTRY_ALIASES.find((entry) => entry.code === normalized)?.code ?? normalized;
  }

  for (const entry of COUNTRY_ALIASES) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) {
      return entry.code;
    }
  }

  return null;
}

