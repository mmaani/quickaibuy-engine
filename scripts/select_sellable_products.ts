import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

type CandidateRow = {
  candidateId: string;
  supplierKey: string;
  supplierProductId: string;
  marketplaceKey: string;
  marketplaceListingId: string;
  estimatedProfit: string | null;
  marginPct: string | null;
  roiPct: string | null;
  listingStatus: string | null;
  listingId: string | null;
  supplierTitle: string | null;
  marketplaceTitle: string | null;
  imageUrl: string | null;
  additionalImageCount: number;
  marketplacePrice: string | null;
};

function toNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const limit = Number(process.argv[2] || "5");
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { scoreSellability } = await import("@/lib/products/sellabilityScore");

  const result = await db.execute<CandidateRow>(sql`
    SELECT
      pc.id::text AS "candidateId",
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      pc.marketplace_key AS "marketplaceKey",
      pc.marketplace_listing_id AS "marketplaceListingId",
      pc.estimated_profit::text AS "estimatedProfit",
      pc.margin_pct::text AS "marginPct",
      pc.roi_pct::text AS "roiPct",
      l.status AS "listingStatus",
      l.id::text AS "listingId",
      pr.title AS "supplierTitle",
      COALESCE(mp.raw_payload->>'title', mp.matched_title) AS "marketplaceTitle",
      COALESCE(mp.image_url, mp.raw_payload->'image'->>'imageUrl') AS "imageUrl",
      COALESCE(jsonb_array_length(COALESCE(mp.raw_payload->'additionalImages', '[]'::jsonb)), 0) AS "additionalImageCount",
      mp.price::text AS "marketplacePrice"
    FROM profitable_candidates pc
    INNER JOIN products_raw pr
      ON pr.supplier_key = pc.supplier_key
      AND pr.supplier_product_id = pc.supplier_product_id
    INNER JOIN marketplace_prices mp
      ON mp.marketplace_key = pc.marketplace_key
      AND mp.marketplace_listing_id = pc.marketplace_listing_id
    LEFT JOIN listings l
      ON l.candidate_id = pc.id
      AND l.marketplace_key = pc.marketplace_key
    WHERE pc.decision_status = 'APPROVED'
      AND pc.listing_eligible = TRUE
      AND pc.marketplace_key = 'ebay'
    ORDER BY pc.calc_ts DESC
  `);

  const scored = result.rows
    .map((row) => {
      const scoring = scoreSellability({
        title: row.marketplaceTitle ?? row.supplierTitle,
        marketplaceTitle: row.marketplaceTitle,
        supplierTitle: row.supplierTitle,
        price: toNum(row.marketplacePrice),
        imageUrl: row.imageUrl,
        additionalImageCount: Number(row.additionalImageCount ?? 0),
      });

      return {
        candidateId: row.candidateId,
        listingId: row.listingId,
        listingStatus: row.listingStatus,
        supplierKey: row.supplierKey,
        supplierProductId: row.supplierProductId,
        marketplaceKey: row.marketplaceKey,
        marketplaceListingId: row.marketplaceListingId,
        title: row.marketplaceTitle ?? row.supplierTitle,
        price: toNum(row.marketplacePrice),
        estimatedProfit: toNum(row.estimatedProfit),
        marginPct: toNum(row.marginPct),
        roiPct: toNum(row.roiPct),
        score: scoring.score,
        threshold: scoring.threshold,
        passed: scoring.passed,
        demandSignal: scoring.demandSignal,
        visualAppeal: scoring.visualAppeal,
        simplicity: scoring.simplicity,
        priceRange: scoring.priceRange,
        clarity: scoring.clarity,
        penalties: scoring.penalties,
        reasons: scoring.reasons,
      };
    })
    .filter((row) => row.passed)
    .sort((a, b) => b.score - a.score || (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0))
    .slice(0, Math.max(3, Math.min(5, limit)));

  console.log(JSON.stringify({ ok: true, count: scored.length, rows: scored }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
