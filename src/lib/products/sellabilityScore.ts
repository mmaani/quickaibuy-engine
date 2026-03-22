export type SellabilityScoreInput = {
  title: string | null;
  marketplaceTitle: string | null;
  supplierTitle: string | null;
  price: number | null;
  imageUrl: string | null;
  additionalImageCount: number;
};

export type SellabilityScoreResult = {
  score: number;
  passed: boolean;
  threshold: number;
  demandSignal: number;
  visualAppeal: number;
  simplicity: number;
  priceRange: number;
  clarity: number;
  penalties: string[];
  reasons: string[];
};

const PASS_THRESHOLD = 65;

const DEMAND_KEYWORDS = [
  "home",
  "decor",
  "gift",
  "kitchen",
  "car",
  "clean",
  "storage",
  "organizer",
  "desk",
  "light",
  "lamp",
];

const COMPLEX_ELECTRONICS_KEYWORDS = [
  "bluetooth",
  "speaker",
  "wireless",
  "charger",
  "charging",
  "smart",
  "rgb",
  "alarm clock",
];

const CLARITY_KEYWORDS = [
  "organizer",
  "holder",
  "light",
  "lamp",
  "storage",
  "cleaner",
  "brush",
  "vacuum",
  "tray",
  "hook",
];

function toText(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function countMatches(text: string, keywords: string[]): number {
  return keywords.filter((keyword) => text.includes(keyword)).length;
}

function scoreDemand(text: string): { score: number; reason: string } {
  const matches = countMatches(text, DEMAND_KEYWORDS);
  return {
    score: Math.min(25, matches * 4 + (matches > 0 ? 5 : 0)),
    reason: matches > 0 ? `${matches} demand keywords matched` : "no strong demand keywords",
  };
}

function scoreVisual(imageUrl: string | null, additionalImageCount: number): { score: number; penalties: string[] } {
  let score = 0;
  const penalties: string[] = [];

  if (!imageUrl) {
    penalties.push("missing primary image");
    return { score, penalties };
  }

  score += 10;
  if (/s-l(960|1200|1400|1600)/i.test(imageUrl)) score += 8;
  else if (/s-l225/i.test(imageUrl)) {
    score += 2;
    penalties.push("low-resolution primary image");
  }

  if (additionalImageCount >= 3) score += 7;
  else if (additionalImageCount >= 1) score += 4;
  else penalties.push("no supporting images");

  return { score: Math.min(25, score), penalties };
}

function scoreSimplicity(text: string): { score: number; penalties: string[] } {
  const matches = countMatches(text, COMPLEX_ELECTRONICS_KEYWORDS);
  if (matches === 0) return { score: 20, penalties: [] };
  if (matches === 1) return { score: 12, penalties: ["contains electronics-heavy language"] };
  if (matches === 2) return { score: 5, penalties: ["multiple electronics-heavy terms"] };
  return { score: 0, penalties: ["complex electronics product profile"] };
}

function scorePriceRange(price: number | null): { score: number; penalties: string[] } {
  if (price == null) return { score: 0, penalties: ["price missing"] };
  if (price >= 10 && price <= 30) return { score: 20, penalties: [] };
  if (price > 30) return { score: 5, penalties: ["price above sweet spot"] };
  return { score: 10, penalties: ["price below target range"] };
}

function scoreClarity(text: string): { score: number; penalties: string[] } {
  const matches = countMatches(text, CLARITY_KEYWORDS);
  if (matches > 0) return { score: 10, penalties: [] };
  return { score: 2, penalties: ["unclear product use"] };
}

export function scoreSellability(input: SellabilityScoreInput): SellabilityScoreResult {
  const text = toText(input.title, input.marketplaceTitle, input.supplierTitle);
  const demand = scoreDemand(text);
  const visual = scoreVisual(input.imageUrl, input.additionalImageCount);
  const simplicity = scoreSimplicity(text);
  const priceRange = scorePriceRange(input.price);
  const clarity = scoreClarity(text);

  const score = demand.score + visual.score + simplicity.score + priceRange.score + clarity.score;
  const penalties = [
    ...visual.penalties,
    ...simplicity.penalties,
    ...priceRange.penalties,
    ...clarity.penalties,
  ];

  return {
    score,
    passed: score >= PASS_THRESHOLD,
    threshold: PASS_THRESHOLD,
    demandSignal: demand.score,
    visualAppeal: visual.score,
    simplicity: simplicity.score,
    priceRange: priceRange.score,
    clarity: clarity.score,
    penalties,
    reasons: [demand.reason],
  };
}
