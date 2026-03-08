import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type ProfitRow = {
  matchId: string;
  supplierKey: string | null;
  supplierProductId: string | null;
  marketplaceKey: string | null;
  marketplaceListingId: string | null;
  matchType: string | null;
  confidence: string | null;
  supplierSnapshotId: string | null;
  marketPriceSnapshotId: string | null;
  supplierPriceMin: string | null;
  marketPrice: string | null;
  shippingPrice: string | null;
};

export async function runProfitEngine(input?: {
  limit?: number;
  supplierKey?: string;
}) {
  const limit = Number(input?.limit ?? 50);
  const minRoiPct = Number(process.env.MIN_ROI_PCT || "15");
  const minMatchConfidence = Number(process.env.PROFIT_MIN_MATCH_CONFIDENCE || "0.50");
  const assumedFeePct = Number(process.env.MARKETPLACE_FEE_PCT || "12");
  const assumedOtherCost = Number(process.env.OTHER_COST_USD || "2");

  const supplierKeyFilter =
    input?.supplierKey && String(input.supplierKey).trim()
      ? String(input.supplierKey).trim().toLowerCase()
      : null;

  const rowsResult = await db.execute<ProfitRow>(sql`
    WITH ranked_matches AS (
      SELECT
        m.id AS match_id,
        m.supplier_key,
        m.supplier_product_id,
        m.marketplace_key,
        m.marketplace_listing_id,
        m.match_type,
        m.confidence,
        m.last_seen_ts,
        ROW_NUMBER() OVER (
          PARTITION BY m.supplier_key, m.supplier_product_id, m.marketplace_key
          ORDER BY
            CAST(m.confidence AS numeric) DESC,
            m.last_seen_ts DESC,
            m.id DESC
        ) AS rn
      FROM matches m
      WHERE
        m.status = 'ACTIVE'
        AND m.match_type IN ('strong_title_similarity', 'title_similarity', 'keyword_fuzzy')
        ${supplierKeyFilter ? sql`AND LOWER(m.supplier_key) = ${supplierKeyFilter}` : sql``}
    ),
    latest_products AS (
      SELECT
        pr.id,
        pr.supplier_key,
        pr.supplier_product_id,
        pr.price_min,
        ROW_NUMBER() OVER (
          PARTITION BY pr.supplier_key, pr.supplier_product_id
          ORDER BY pr.id DESC
        ) AS rn
      FROM products_raw pr
      ${supplierKeyFilter ? sql`WHERE LOWER(pr.supplier_key) = ${supplierKeyFilter}` : sql``}
    ),
    latest_marketplace_prices AS (
      SELECT
        mp.id,
        mp.product_raw_id,
        mp.marketplace_key,
        mp.marketplace_listing_id,
        mp.price,
        mp.shipping_price,
        mp.snapshot_ts,
        ROW_NUMBER() OVER (
          PARTITION BY mp.product_raw_id, mp.marketplace_key, mp.marketplace_listing_id
          ORDER BY mp.snapshot_ts DESC, mp.id DESC
        ) AS rn
      FROM marketplace_prices mp
      ${supplierKeyFilter ? sql`WHERE LOWER(mp.supplier_key) = ${supplierKeyFilter}` : sql``}
    )
    SELECT
      rm.match_id AS "matchId",
      rm.supplier_key AS "supplierKey",
      rm.supplier_product_id AS "supplierProductId",
      rm.marketplace_key AS "marketplaceKey",
      rm.marketplace_listing_id AS "marketplaceListingId",
      rm.match_type AS "matchType",
      rm.confidence AS "confidence",
      lp.id AS "supplierSnapshotId",
      lmp.id AS "marketPriceSnapshotId",
      lp.price_min AS "supplierPriceMin",
      lmp.price AS "marketPrice",
      lmp.shipping_price AS "shippingPrice"
    FROM ranked_matches rm
    INNER JOIN latest_products lp
      ON lp.supplier_key = rm.supplier_key
      AND lp.supplier_product_id = rm.supplier_product_id
      AND lp.rn = 1
    INNER JOIN latest_marketplace_prices lmp
      ON lmp.product_raw_id = lp.id
      AND lmp.marketplace_key = rm.marketplace_key
      AND lmp.marketplace_listing_id = rm.marketplace_listing_id
      AND lmp.rn = 1
    WHERE rm.rn = 1
    ORDER BY CAST(rm.confidence AS numeric) DESC, rm.last_seen_ts DESC
    LIMIT ${limit}
  `);

  const rows = rowsResult.rows ?? [];

  let insertedOrUpdated = 0;
  let skipped = 0;

  const acceptedRows: ProfitRow[] = [];

  for (const row of rows) {
    const matchConfidence = toNum(row.confidence) ?? 0;
    if (matchConfidence < minMatchConfidence) {
      skipped++;
      continue;
    }

    const supplierCost = toNum(row.supplierPriceMin);
    const marketPrice = toNum(row.marketPrice);
    const shipping = toNum(row.shippingPrice) ?? 0;

    if (supplierCost == null || marketPrice == null) {
      skipped++;
      continue;
    }

    const estimatedFees = Number(((marketPrice * assumedFeePct) / 100).toFixed(2));
    const estimatedShipping = Number(shipping.toFixed(2));
    const estimatedCogs = Number((supplierCost + assumedOtherCost).toFixed(2));
    const estimatedProfit = Number(
      (marketPrice - estimatedFees - estimatedShipping - estimatedCogs).toFixed(2)
    );
    const roiPct =
      estimatedCogs > 0 ? Number(((estimatedProfit / estimatedCogs) * 100).toFixed(2)) : 0;

    if (roiPct < minRoiPct) {
      skipped++;
      continue;
    }

    acceptedRows.push(row);
  }

  let staleDeleted = 0;

  if (acceptedRows.length > 0) {
    const acceptedPairs = acceptedRows.map((row) => sql`
      (
        ${String(row.supplierKey || "").toLowerCase()},
        ${row.supplierProductId},
        ${row.marketplaceKey},
        ${row.marketplaceListingId}
      )
    `);

    const staleCountResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM profitable_candidates pc
      WHERE
        ${supplierKeyFilter ? sql`LOWER(pc.supplier_key) = ${supplierKeyFilter} AND` : sql``}
        (pc.supplier_key, pc.supplier_product_id, pc.marketplace_key, pc.marketplace_listing_id)
        NOT IN (${sql.join(acceptedPairs, sql`, `)})
    `);

    staleDeleted = Number(staleCountResult.rows?.[0]?.count ?? 0);

    await db.execute(sql`
      DELETE FROM profitable_candidates pc
      WHERE
        ${supplierKeyFilter ? sql`LOWER(pc.supplier_key) = ${supplierKeyFilter} AND` : sql``}
        (pc.supplier_key, pc.supplier_product_id, pc.marketplace_key, pc.marketplace_listing_id)
        NOT IN (${sql.join(acceptedPairs, sql`, `)})
    `);
  } else if (supplierKeyFilter) {
    const staleCountResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM profitable_candidates pc
      WHERE LOWER(pc.supplier_key) = ${supplierKeyFilter}
    `);

    staleDeleted = Number(staleCountResult.rows?.[0]?.count ?? 0);

    await db.execute(sql`
      DELETE FROM profitable_candidates pc
      WHERE LOWER(pc.supplier_key) = ${supplierKeyFilter}
    `);
  }

  for (const row of acceptedRows) {
    const normalizedSupplierKey = String(row.supplierKey || "").toLowerCase();
    const supplierProductId = row.supplierProductId;
    const marketplaceKey = row.marketplaceKey;
    const marketplaceListingId = row.marketplaceListingId;

    const matchConfidence = toNum(row.confidence) ?? 0;
    const supplierCost = toNum(row.supplierPriceMin) ?? 0;
    const marketPrice = toNum(row.marketPrice) ?? 0;
    const shipping = toNum(row.shippingPrice) ?? 0;

    const estimatedFees = Number(((marketPrice * assumedFeePct) / 100).toFixed(2));
    const estimatedShipping = Number(shipping.toFixed(2));
    const estimatedCogs = Number((supplierCost + assumedOtherCost).toFixed(2));
    const estimatedProfit = Number(
      (marketPrice - estimatedFees - estimatedShipping - estimatedCogs).toFixed(2)
    );
    const marginPct =
      marketPrice > 0 ? Number(((estimatedProfit / marketPrice) * 100).toFixed(2)) : 0;
    const roiPct =
      estimatedCogs > 0 ? Number(((estimatedProfit / estimatedCogs) * 100).toFixed(2)) : 0;

    const estimatedFeesJson = {
      feePct: assumedFeePct,
      feeUsd: estimatedFees,
      otherCostUsd: assumedOtherCost,
      matchConfidence,
      matchType: row.matchType,
      selectionMode: "latest_best_active_match_per_supplier_product",
      matchId: row.matchId,
    };

    await db.execute(sql`
      INSERT INTO profitable_candidates (
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        calc_ts,
        supplier_snapshot_id,
        market_price_snapshot_id,
        estimated_fees,
        estimated_shipping,
        estimated_cogs,
        estimated_profit,
        margin_pct,
        roi_pct,
        risk_flags,
        decision_status,
        reason
      ) VALUES (
        ${normalizedSupplierKey},
        ${supplierProductId},
        ${marketplaceKey},
        ${marketplaceListingId},
        NOW(),
        ${row.supplierSnapshotId},
        ${row.marketPriceSnapshotId},
        ${JSON.stringify(estimatedFeesJson)}::jsonb,
        ${String(estimatedShipping)},
        ${String(estimatedCogs)},
        ${String(estimatedProfit)},
        ${String(marginPct)},
        ${String(roiPct)},
        ARRAY[]::text[],
        'PENDING',
        ${`roi ${roiPct}% >= minimum ${minRoiPct}% | match ${matchConfidence}`}
      )
      ON CONFLICT (supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id)
      DO UPDATE SET
        calc_ts = NOW(),
        supplier_snapshot_id = EXCLUDED.supplier_snapshot_id,
        market_price_snapshot_id = EXCLUDED.market_price_snapshot_id,
        estimated_fees = EXCLUDED.estimated_fees,
        estimated_shipping = EXCLUDED.estimated_shipping,
        estimated_cogs = EXCLUDED.estimated_cogs,
        estimated_profit = EXCLUDED.estimated_profit,
        margin_pct = EXCLUDED.margin_pct,
        roi_pct = EXCLUDED.roi_pct,
        risk_flags = EXCLUDED.risk_flags,
        decision_status = EXCLUDED.decision_status,
        reason = EXCLUDED.reason
    `);

    insertedOrUpdated++;
  }

  return {
    ok: true,
    scanned: rows.length,
    insertedOrUpdated,
    skipped,
    staleDeleted,
    minRoiPct,
    minMatchConfidence,
  };
}
