import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getTrendCandidates } from "@/lib/db/trendCandidates";
import { getProductMarketIntelligenceOverview } from "@/lib/learningHub/productMarketIntelligence";
import { getSupplierLearningAdjustments } from "@/lib/learningHub/pipelineWriters";
import { loadRuntimeEnv, getLoadedRuntimeEnvPath } from "@/lib/runtimeEnv";
import {
  buildDiscoveryWaveSourcePlan,
  getDiscoveryOpportunityTier,
} from "@/lib/suppliers/discoveryWave";
import {
  computeSupplierIntelligenceSignal,
  canonicalSupplierKey,
  getSupplierWaveBudget,
  shouldRejectSupplierEarly,
} from "@/lib/suppliers/intelligence";

loadRuntimeEnv();

type LatestDiscoverRow = {
  supplier_key: string | null;
  fetched_count: number | null;
  parsed_count: number | null;
  valid_count: number | null;
  eligible_count: number | null;
  inserted_new_count: number | null;
  top_rejection_reasons: unknown;
};

type CandidateMixRow = {
  supplier_key: string | null;
  total_candidates: number | null;
  approved_candidates: number | null;
  listing_ready_candidates: number | null;
  manual_review_candidates: number | null;
  origin_unresolved_blocks: number | null;
};

type RecentSnapshotRow = {
  supplierKey: string;
  supplierProductId: string;
  availabilityStatus: string | null;
  shippingEstimates: unknown;
  rawPayload: unknown;
  snapshotTs: string | Date | null;
};

type ShippingLearningRow = {
  observedAt: string | Date | null;
  diagnostics: unknown;
};

function toNum(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function main() {
  const [supplierLearning, intelligence, trendCandidates] = await Promise.all([
    getSupplierLearningAdjustments(),
    getProductMarketIntelligenceOverview({ windowDays: 90, includeNodes: 12 }),
    getTrendCandidates(20, { staleFirst: true }),
  ]);

  const sourcePlan = buildDiscoveryWaveSourcePlan({
    limitPerKeyword: 20,
    learningAdjustments: supplierLearning,
    comboBoosts: intelligence.discoveryHints.supplierBoostByMarketplace,
  });

  const [latestDiscover, candidateMix, recentSnapshots, latestShippingLearning] = await Promise.all([
    db.execute<LatestDiscoverRow>(sql`
      WITH latest AS (
        SELECT details->'sourceBreakdown' AS source_breakdown
        FROM audit_log
        WHERE actor_id = 'supplier:discover'
          AND event_type = 'SUPPLIER_PRODUCTS_DISCOVERED'
        ORDER BY event_ts DESC NULLS LAST
        LIMIT 1
      )
      SELECT
        entry->>'source' AS supplier_key,
        COALESCE((entry->>'fetched_count')::int, 0) AS fetched_count,
        COALESCE((entry->>'parsed_count')::int, 0) AS parsed_count,
        COALESCE((entry->>'valid_count')::int, 0) AS valid_count,
        COALESCE((entry->>'eligible_count')::int, 0) AS eligible_count,
        COALESCE((entry->>'inserted_new_count')::int, 0) AS inserted_new_count,
        COALESCE(entry->'top_rejection_reasons', '[]'::jsonb) AS top_rejection_reasons
      FROM latest
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(source_breakdown, '[]'::jsonb)) AS entry
      ORDER BY supplier_key ASC
    `),
    db.execute<CandidateMixRow>(sql`
      SELECT
        lower(coalesce(pc.supplier_key, 'unknown')) AS supplier_key,
        count(*)::int AS total_candidates,
        count(*) FILTER (WHERE pc.decision_status = 'APPROVED')::int AS approved_candidates,
        count(*) FILTER (WHERE pc.listing_eligible = true)::int AS listing_ready_candidates,
        count(*) FILTER (WHERE pc.decision_status = 'MANUAL_REVIEW')::int AS manual_review_candidates,
        count(*) FILTER (
          WHERE lower(coalesce(pc.listing_block_reason, '')) LIKE '%us_origin_unresolved%'
             OR lower(coalesce(pc.listing_block_reason, '')) LIKE '%origin unresolved%'
        )::int AS origin_unresolved_blocks
      FROM profitable_candidates pc
      GROUP BY lower(coalesce(pc.supplier_key, 'unknown'))
      ORDER BY total_candidates DESC, supplier_key ASC
    `),
    db.execute<RecentSnapshotRow>(sql`
      WITH latest_rows AS (
        SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
          lower(pr.supplier_key) AS "supplierKey",
          pr.supplier_product_id AS "supplierProductId",
          pr.availability_status AS "availabilityStatus",
          pr.shipping_estimates AS "shippingEstimates",
          pr.raw_payload AS "rawPayload",
          pr.snapshot_ts AS "snapshotTs"
        FROM products_raw pr
        WHERE pr.snapshot_ts >= now() - interval '30 days'
        ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
      )
      SELECT *
      FROM latest_rows
      ORDER BY "snapshotTs" DESC NULLS LAST
      LIMIT 3000
    `),
    db.execute<ShippingLearningRow>(sql`
      SELECT observed_at AS "observedAt", diagnostics AS diagnostics
      FROM learning_evidence_events
      WHERE source = 'automateShippingIntelligence'
        AND entity_id = 'shippingAutomation'
      ORDER BY observed_at DESC NULLS LAST
      LIMIT 1
    `),
  ]);

  const recentSnapshotRows = recentSnapshots.rows ?? [];
  const projectedBySupplier = new Map<
    string,
    {
      sampledSnapshots: number;
      viableForUs: number;
      strongOriginViable: number;
      unresolvedOriginRejected: number;
      weakTransparencyRejected: number;
      projectedSearchLimit: number;
      inferredProjectedWeight: number;
    }
  >();

  for (const row of recentSnapshotRows) {
    const supplierKey = canonicalSupplierKey(String(row.supplierKey ?? "").trim().toLowerCase());
    if (!supplierKey) continue;
    const plan = sourcePlan.find((entry) => entry.source === supplierKey);
    const budget = getSupplierWaveBudget(supplierKey);
    const signal = computeSupplierIntelligenceSignal({
      supplierKey,
      destinationCountry: "US",
      availabilitySignal: row.availabilityStatus,
      shippingEstimates: row.shippingEstimates,
      rawPayload: row.rawPayload,
      shippingConfidence: asObject(row.rawPayload)?.shippingConfidence,
    });
    const gate = shouldRejectSupplierEarly({
      supplierKey,
      destinationCountry: "US",
      availabilitySignal: row.availabilityStatus,
      shippingEstimates: row.shippingEstimates,
      rawPayload: row.rawPayload,
      shippingConfidence: asObject(row.rawPayload)?.shippingConfidence,
      minimumReliabilityScore: budget.minimumReliabilityScore,
      economicsAcceptable: true,
    });
    const tier = getDiscoveryOpportunityTier(signal);
    const current = projectedBySupplier.get(supplierKey) ?? {
      sampledSnapshots: 0,
      viableForUs: 0,
      strongOriginViable: 0,
      unresolvedOriginRejected: 0,
      weakTransparencyRejected: 0,
      projectedSearchLimit: plan?.searchLimit ?? 0,
      inferredProjectedWeight: 0,
    };
    current.sampledSnapshots += 1;
    if (!gate.reject) current.viableForUs += 1;
    if (!gate.reject && tier !== "ORIGIN_UNRESOLVED") current.strongOriginViable += 1;
    if (gate.reason === "us_origin_unresolved") current.unresolvedOriginRejected += 1;
    if (gate.reason === "shipping_transparency_too_weak") current.weakTransparencyRejected += 1;
    projectedBySupplier.set(supplierKey, current);
  }

  const projectedMix = Array.from(projectedBySupplier.entries())
    .map(([supplierKey, row]) => {
      const strongOriginRate = row.sampledSnapshots > 0 ? row.strongOriginViable / row.sampledSnapshots : 0;
      const unresolvedRate = row.sampledSnapshots > 0 ? row.unresolvedOriginRejected / row.sampledSnapshots : 0;
      const inferredProjectedWeight = row.projectedSearchLimit * Math.max(0.05, strongOriginRate) * (1 - unresolvedRate * 0.7);
      return {
        supplierKey,
        sampledSnapshots: row.sampledSnapshots,
        viableForUs: row.viableForUs,
        strongOriginViable: row.strongOriginViable,
        unresolvedOriginRejected: row.unresolvedOriginRejected,
        weakTransparencyRejected: row.weakTransparencyRejected,
        projectedSearchLimit: row.projectedSearchLimit,
        inferredProjectedWeight: Number(inferredProjectedWeight.toFixed(4)),
      };
    })
    .sort((left, right) => right.inferredProjectedWeight - left.inferredProjectedWeight || left.supplierKey.localeCompare(right.supplierKey));

  const projectedWeightTotal = projectedMix.reduce((sum, row) => sum + row.inferredProjectedWeight, 0);
  const normalizedProjectedMix = projectedMix.map((row) => ({
    ...row,
    inferredProjectedSharePct:
      projectedWeightTotal > 0 ? Number(((row.inferredProjectedWeight / projectedWeightTotal) * 100).toFixed(2)) : 0,
  }));

  const shippingDiagnostics = asObject(latestShippingLearning.rows?.[0]?.diagnostics);
  const bySupplierShipping = asArray(shippingDiagnostics?.bySupplier).map((entry) => {
    const row = asObject(entry);
    return {
      supplierKey: String(row?.supplierKey ?? "unknown"),
      blocked: toNum(row?.blocked),
      persistedQuotes: toNum(row?.persistedQuotes),
    };
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        runtimeEnvPath: getLoadedRuntimeEnvPath(),
        trendCandidateCount: trendCandidates.length,
        currentMix: {
          latestDiscoverBreakdown: (latestDiscover.rows ?? []).map((row) => ({
            supplierKey: String(row.supplier_key ?? "unknown"),
            fetched: toNum(row.fetched_count),
            parsed: toNum(row.parsed_count),
            valid: toNum(row.valid_count),
            eligible: toNum(row.eligible_count),
            inserted: toNum(row.inserted_new_count),
            topRejectionReasons: asArray(row.top_rejection_reasons).map((value) => String(value)),
          })),
          profitableCandidateMix: (candidateMix.rows ?? []).map((row) => ({
            supplierKey: String(row.supplier_key ?? "unknown"),
            totalCandidates: toNum(row.total_candidates),
            approvedCandidates: toNum(row.approved_candidates),
            listingReadyCandidates: toNum(row.listing_ready_candidates),
            manualReviewCandidates: toNum(row.manual_review_candidates),
            originUnresolvedBlocks: toNum(row.origin_unresolved_blocks),
          })),
          latestShippingRefreshBySupplier: bySupplierShipping,
        },
        projectedMixAfterSteering: {
          sourcePlan,
          inferredFromRecentSnapshots: normalizedProjectedMix,
          inferenceNote:
            "Projected mix is an inference from current source plan plus the recent strong-origin viable rate in latest supplier snapshots. It is readonly and does not mutate discovery state.",
        },
      },
      null,
      2
    )
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("diagnose_supplier_discovery_wave failed", error);
    process.exit(1);
  });
