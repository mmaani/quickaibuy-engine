import assert from "node:assert/strict";
import { getProductMarketIntelligenceOverview } from "@/lib/learningHub/productMarketIntelligence";

async function main() {
  const overview = await getProductMarketIntelligenceOverview({ windowDays: 90, includeNodes: 8 });

  assert.ok(overview.generatedAt);
  assert.ok(overview.categoryIntelligence.strongest.length >= 0);
  assert.ok(overview.productProfileIntelligence.strongest.length >= 0);
  assert.ok(overview.marketplaceFitIntelligence.length >= 0);
  assert.ok(overview.attributeIntelligence.length >= 0);
  assert.ok(overview.supplierMarketplaceIntelligence.length >= 0);
  assert.ok(overview.opportunities.every((row) => row.opportunity.score >= 0 && row.opportunity.score <= 1));

  const summary = {
    productCount: overview.knowledgeGraph.productCount,
    categoryCount: overview.knowledgeGraph.categories,
    profileCount: overview.knowledgeGraph.profiles,
    topCategory: overview.categoryIntelligence.strongest[0]?.label ?? null,
    topProfile: overview.productProfileIntelligence.strongest[0]?.label ?? null,
    topOpportunity: overview.opportunities[0]
      ? {
          candidateId: overview.opportunities[0].candidateId,
          score: overview.opportunities[0].opportunity.score,
          positives: overview.opportunities[0].opportunity.explanation.positives,
          negatives: overview.opportunities[0].opportunity.explanation.negatives,
        }
      : null,
  };

  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
