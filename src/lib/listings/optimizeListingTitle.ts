type OptimizeListingTitleInput = {
  marketplaceTitle: string | null;
  supplierTitle: string | null;
  supplierKey: string;
  supplierProductId: string;
};

const TITLE_LIMIT = 80;

const NOISE_PATTERNS = [
  /\bnew\b/gi,
  /\bmultifunction\b/gi,
  /\bcompatible\b/gi,
  /\bcomputer\b/gi,
  /\bphone\b/gi,
  /\bdesktop\b/gi,
  /\blarge\b/gi,
  /\bsmall\b/gi,
  /\bportable\b/gi,
];

const REDUCED_ELECTRONICS_WORDS = new Set([
  "audio",
  "bluetooth",
  "wireless",
  "speaker",
  "speakers",
  "smart",
  "device",
  "devices",
  "charger",
  "charging",
  "electronics",
  "electronic",
]);

const STOPWORDS = new Set([
  "and",
  "for",
  "with",
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
]);

function preferredPhrase(source: string): string[] {
  const normalized = source.toLowerCase();
  if (
    normalized.includes("night light") ||
    normalized.includes("ambient") ||
    normalized.includes("bedside") ||
    normalized.includes("lamp")
  ) {
    return ["Ambient", "Night", "Light", "Home", "Decor"];
  }
  if (normalized.includes("crystal") || normalized.includes("acrylic")) {
    return ["Decorative", "Lamp", "Home", "Decor", "Gift"];
  }
  if (normalized.includes("magnetic") && normalized.includes("car")) {
    return ["Magnetic", "Car", "Phone", "Mount", "Holder"];
  }
  if (normalized.includes("fan")) {
    return ["Mini", "Portable", "Fan", "Desk", "Cooling"];
  }
  if (normalized.includes("desk")) {
    return ["Desk", "Decor", "Organizer", "Gift"];
  }
  return ["Home", "Desk", "Decor", "Gift"];
}

function cleanTitle(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-&,./()]/gu, "")
    .trim()
    .slice(0, TITLE_LIMIT);
}

function titleCase(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function optimizeListingTitle(input: OptimizeListingTitleInput): string {
  const source =
    input.marketplaceTitle?.trim() ||
    input.supplierTitle?.trim() ||
    `${input.supplierKey} ${input.supplierProductId}`;

  let normalized = source;
  for (const pattern of NOISE_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }

  const baseWords = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => !STOPWORDS.has(word.toLowerCase()))
    .filter((word) => !REDUCED_ELECTRONICS_WORDS.has(word.toLowerCase()))
    .map(titleCase);

  const preferredCore = dedupePreserveOrder(baseWords).slice(0, 5);
  const marketingWords = preferredPhrase(source);
  const composed = dedupePreserveOrder([...preferredCore, ...marketingWords]);

  let optimized = composed.join(" ").trim();
  if (!optimized) {
    optimized = "Home Desk Decor Gift";
  }

  if (optimized.length < 45) {
    const extended = dedupePreserveOrder([
      ...composed,
      "Modern",
      "Stylish",
      "Room",
      "Accessory",
    ]);
    optimized = extended.join(" ").trim();
  }

  while (optimized.length > TITLE_LIMIT && composed.length > 1) {
    composed.pop();
    optimized = composed.join(" ").trim();
  }

  return cleanTitle(optimized);
}
