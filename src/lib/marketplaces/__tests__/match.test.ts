import test from "node:test";
import assert from "node:assert/strict";

import { scoreCandidate } from "@/lib/marketplaces/match";
import type { MarketplaceCandidate } from "@/lib/marketplaces/ebay";

function makeCandidate(title: string, price = 24.99): MarketplaceCandidate {
  return {
    marketplaceKey: "ebay",
    marketplaceListingId: title.toLowerCase().replace(/\s+/g, "-"),
    matchedTitle: title,
    price,
    shippingPrice: 0,
    currency: "USD",
    sellerId: "seller-1",
    sellerName: "seller-1",
    availabilityStatus: "IN_STOCK",
    productPageUrl: "https://example.com/p/1",
    imageUrl: "https://example.com/i/1.jpg",
    isPrime: null,
    rawPayload: { title },
  };
}

test("semantic + product truth model prefers exact JISULIFE fan case over generic/variant cases", () => {
  const product = {
    title: "JISULIFE Mini Portable Handheld Fan Case",
    mainKeywords: ["JISULIFE", "mini fan case", "portable fan cover"],
    rawPayload: { brand: "JISULIFE", price: 7.5 },
  };

  const exact = scoreCandidate(product, makeCandidate("JISULIFE Mini Portable Handheld Fan Protective Case", 19.99));
  const generic = scoreCandidate(product, makeCandidate("Generic Mini Handheld Fan Case Cute Travel Pouch", 16.5));
  const wrongForm = scoreCandidate(product, makeCandidate("JISULIFE Mini Portable Handheld Fan 3 Speeds Rechargeable", 39.99));

  assert.ok((exact.finalMatchScore ?? 0) > (generic.finalMatchScore ?? 0));
  assert.ok((generic.finalMatchScore ?? 0) > (wrongForm.finalMatchScore ?? 0));
  assert.ok((exact.productTruthScore ?? 0) > (wrongForm.productTruthScore ?? 0));
});

test("price outlier is penalized but does not override product truth", () => {
  const product = {
    title: "JISULIFE Mini Portable Handheld Fan Case",
    mainKeywords: ["JISULIFE", "fan case"],
    rawPayload: { brand: "JISULIFE", price: 8 },
  };

  const sane = scoreCandidate(product, makeCandidate("JISULIFE Mini Portable Handheld Fan Case", 22));
  const outlier = scoreCandidate(product, makeCandidate("JISULIFE Mini Portable Handheld Fan Case", 199));

  assert.ok((sane.finalMatchScore ?? 0) > (outlier.finalMatchScore ?? 0));
  assert.ok((outlier.productTruthScore ?? 0) >= 0.8);
  assert.ok((outlier.priceSanityScore ?? 1) < (sane.priceSanityScore ?? 0));
});

test("evidence remains deterministic and explainable", () => {
  const product = {
    title: "JISULIFE Mini Portable Handheld Fan Case",
    mainKeywords: ["JISULIFE", "fan case"],
    rawPayload: { brand: "JISULIFE", price: 8 },
  };

  const scored = scoreCandidate(product, makeCandidate("Cute Mini Fan Case", 20));
  const evidence = scored.matchEvidence as Record<string, unknown>;

  assert.equal(typeof evidence.semanticSimilarity, "number");
  assert.equal(typeof evidence.lexicalSimilarity, "number");
  assert.equal(typeof evidence.brandAlignment, "number");
  assert.equal(typeof evidence.productTypeAlignment, "number");
  assert.equal(typeof evidence.specAlignment, "number");
  assert.equal(typeof evidence.quantityPackAlignment, "number");
  assert.equal(typeof evidence.priceSanityContribution, "object");
  assert.equal(typeof evidence.finalSelectionReason, "string");
});
