import "dotenv/config";
import { getMatchQualitySummary } from "@/lib/control/getMatchQualitySummary";

async function main() {
  const summary = await getMatchQualitySummary();

  console.log("\nmatch_quality_summary");
  console.table([
    {
      matches: summary.totalMatches ?? 0,
      active_matches: summary.activeMatches ?? 0,
      inactive_matches: summary.inactiveMatches ?? 0,
      low_confidence_matches: summary.lowConfidenceCount ?? 0,
      low_confidence_active_matches: summary.lowConfidenceAcceptedMatches ?? 0,
      borderline_active_matches: summary.borderlineAcceptedMatches ?? 0,
      duplicate_pair_count: summary.duplicatePairCount ?? 0,
      weak_match_count: summary.weakMatchCount ?? 0,
      invalid_supplier_keys: summary.supplierKeyConsistency.invalidKeyCount ?? 0,
      noncanonical_supplier_keys: summary.supplierKeyConsistency.nonCanonicalKeyCount ?? 0,
    },
  ]);

  console.log("\nconfidence_distribution");
  console.table(summary.confidenceDistribution);

  console.log("\nweak_match_reasons");
  console.table(summary.weakMatchReasons);

  console.log("\nduplicate_patterns");
  console.table(summary.duplicatePatterns);

  console.log("\nsupplier_key_consistency");
  console.table(summary.supplierKeyConsistency.inconsistentGroups);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
