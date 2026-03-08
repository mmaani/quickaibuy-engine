import { db } from "@/lib/db";
import {
  productsRaw,
  marketplacePrices,
  matches,
} from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function runProfitEngine(input?: {
  limit?: number;
  supplierKey?: string;
}) {
  const limit = Number(input?.limit ?? 50);
  const minRoiPct = Number(process.env.MIN_ROI_PCT || "15");
  const assumedFeePct = Number(process.env.MARKETPLACE_FEE_PCT || "12");
  const assumedOtherCost = Number(process.env.OTHER_COST_USD || "2");

  const rows = await db
    .select({
      matchId: matches.id,
      supplierKey: matches.supplierKey,
      supplierProductId: matches.supplierProductId,
      marketplaceKey: matches.marketplaceKey,
      marketplaceListingId: matches.marketplaceListingId,
      supplierSnapshotId: productsRaw.id,
      marketPriceSnapshotId: marketplacePrices.id,
      supplierPriceMin: productsRaw.priceMin,
      marketPrice: marketplacePrices.price,
      shippingPrice: marketplacePrices.shippingPrice,
      confidence: matches.confidence,
    })
    .from(matches)
    .innerJoin(
      productsRaw,
      and(
        eq(productsRaw.supplierKey, matches.supplierKey),
        eq(productsRaw.supplierProductId, matches.supplierProductId)
      )
    )
    .innerJoin(
      marketplacePrices,
      and(
        eq(marketplacePrices.marketplaceKey, matches.marketplaceKey),
        eq(marketplacePrices.marketplaceListingId, matches.marketplaceListingId)
      )
    )
    .where(eq(matches.status, "ACTIVE"))
    .orderBy(desc(matches.lastSeenTs))
    .limit(limit);

  let insertedOrUpdated = 0;
  let skipped = 0;

  for (const row of rows) {
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
    const marginPct =
      marketPrice > 0 ? Number(((estimatedProfit / marketPrice) * 100).toFixed(2)) : 0;
    const roiPct =
      estimatedCogs > 0 ? Number(((estimatedProfit / estimatedCogs) * 100).toFixed(2)) : 0;

    if (roiPct < minRoiPct) {
      skipped++;
      continue;
    }

    const estimatedFeesJson = {
      feePct: assumedFeePct,
      feeUsd: estimatedFees,
      otherCostUsd: assumedOtherCost,
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
        ${row.supplierKey},
        ${row.supplierProductId},
        ${row.marketplaceKey},
        ${row.marketplaceListingId},
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
        ${`roi ${roiPct}% >= minimum ${minRoiPct}%`}
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
    minRoiPct,
  };
}
