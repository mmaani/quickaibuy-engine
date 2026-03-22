type GenerateListingDescriptionInput = {
  title: string;
  supplierTitle: string | null;
  supplierRawPayload?: unknown;
};

const BANNED_TERMS = [
  /\belectronics?\b/gi,
  /\bsmart device\b/gi,
  /\bcharger\b/gi,
];

function cleanText(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();
  for (const pattern of BANNED_TERMS) {
    text = text.replace(pattern, "");
  }
  return text.replace(/\s+/g, " ").trim();
}

function inferProductType(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes("light") || normalized.includes("lamp") || normalized.includes("rgb")) {
    return "accent decor piece";
  }
  if (normalized.includes("speaker") || normalized.includes("clock")) {
    return "decor accent";
  }
  if (normalized.includes("car")) {
    return "organizer";
  }
  return "home accessory";
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractFeatureBullets(rawPayload: unknown): string[] {
  const payload = objectOrNull(rawPayload);
  const features = Array.isArray(payload?.features)
    ? payload.features
    : Array.isArray(payload?.featureBullets)
      ? payload.featureBullets
      : [];

  const cleaned = features
    .map((feature) => cleanText(String(feature ?? "")))
    .filter((feature) => feature.length > 0)
    .slice(0, 3);

  if (cleaned.length) return cleaned;

  return [
    "Portable footprint that fits shelves, desks, and bedside spaces.",
    "Modern design that blends into home and office setups.",
    "Practical everyday use with a clean, giftable presentation.",
  ];
}

function buildUseCases(title: string): string[] {
  const normalized = title.toLowerCase();
  if (normalized.includes("car")) {
    return ["Daily car organization", "Road trip storage", "Useful gift idea"];
  }
  if (normalized.includes("light") || normalized.includes("lamp") || normalized.includes("rgb")) {
    return ["Home decor", "Desk styling", "Gift-ready accent"];
  }
  return ["Home decor", "Office", "Gifts"];
}

export function generateListingDescription(
  input: GenerateListingDescriptionInput
): string {
  const title = cleanText(input.title);
  const productType = inferProductType(`${title} ${input.supplierTitle ?? ""}`);
  const benefits = extractFeatureBullets(input.supplierRawPayload);
  const useCases = buildUseCases(title);

  const lines = [
    `Stylish and functional ${productType} designed for home and desk use.`,
    "",
    "Benefits",
    ...benefits.map((benefit) => `- ${benefit}`),
    "",
    "Use cases",
    ...useCases.map((useCase) => `- ${useCase}`),
    "",
    "Shipping",
    "- Handling 1-2 days",
    "- Delivery 7-12 days",
    "- Tracking included",
    "",
    "Guarantee",
    "- 30-day return",
  ];

  return lines.join("\n").trim();
}
