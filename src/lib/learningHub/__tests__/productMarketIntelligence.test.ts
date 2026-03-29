import test from "node:test";
import assert from "node:assert/strict";
import {
  computeOpportunityScore,
  getDiscoveryKeywordAdjustment,
} from "@/lib/learningHub/productMarketIntelligence";

test("computeOpportunityScore stays explainable and favors strong publishable opportunities", () => {
  const strong = computeOpportunityScore({
    supplierReliability: 0.86,
    stockEvidenceStrength: 0.84,
    shippingEvidenceStrength: 0.8,
    categoryQuality: 0.78,
    productProfileQuality: 0.82,
    marketplaceFitQuality: 0.79,
    matchConfidence: 0.9,
    attributeCompleteness: 0.76,
    profitQuality: 0.74,
    publishabilityScore: 0.88,
    failurePressure: 0.12,
    driftPressure: 0.1,
  });
  const weak = computeOpportunityScore({
    supplierReliability: 0.42,
    stockEvidenceStrength: 0.35,
    shippingEvidenceStrength: 0.28,
    categoryQuality: 0.31,
    productProfileQuality: 0.33,
    marketplaceFitQuality: 0.29,
    matchConfidence: 0.52,
    attributeCompleteness: 0.22,
    profitQuality: 0.4,
    publishabilityScore: 0.3,
    failurePressure: 0.62,
    driftPressure: 0.58,
  });

  assert.ok(strong.score > weak.score);
  assert.ok(strong.explanation.positives.length > 0);
  assert.ok(weak.explanation.negatives.length > 0);
});

test("discovery keyword adjustment deprioritizes paused/weak profiles", () => {
  const overview = {
    categoryIntelligence: {
      strongest: [
        {
          key: "lighting-decor",
          opportunityScore: 0.82,
          recommendation: "prioritize",
        },
      ],
      weakest: [
        {
          key: "home-decor-gifts",
          opportunityScore: 0.28,
          recommendation: "pause",
        },
      ],
    },
    productProfileIntelligence: {
      strongest: [
        {
          key: "night-light",
          opportunityScore: 0.84,
          recommendation: "best_now",
        },
      ],
      weakest: [
        {
          key: "home-decor-gift",
          opportunityScore: 0.22,
          recommendation: "filter_early",
        },
      ],
    },
  } as unknown as Parameters<typeof getDiscoveryKeywordAdjustment>[1];

  const strong = getDiscoveryKeywordAdjustment("ambient night light", overview);
  const weak = getDiscoveryKeywordAdjustment("decor gift ornament", overview);

  assert.ok(strong.score > weak.score);
  assert.equal(strong.shouldFilterEarly, false);
  assert.equal(weak.shouldFilterEarly, true);
});
