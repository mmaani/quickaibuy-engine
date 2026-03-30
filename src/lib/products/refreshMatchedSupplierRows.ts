import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { db } from "@/lib/db";
import { prepareListingPreviewForCandidate } from "@/lib/listings/prepareListingPreviews";
import { handleMarketplaceScanJob } from "@/lib/jobs/marketplaceScan";
import { handleMatchProductsJob } from "@/lib/jobs/matchProducts";
import { runProfitEngine } from "@/lib/profit/profitEngine";
import { refreshSingleSupplierProduct } from "@/lib/products/refreshSingleSupplierProduct";
import { compareSupplierIntelligence, computeSupplierIntelligenceSignal } from "@/lib/suppliers/intelligence";
import { getSupplierRefreshSuccessRateMap } from "@/lib/suppliers/telemetry";
import { sql } from "drizzle-orm";

export type MatchedSupplierRefreshTarget = {
  supplierKey: string;
  supplierProductId: string;
  currentSnapshotId: string | null;
  candidateIds: string[];
  shippingEstimates: unknown;
  rawPayload: unknown;
};

export type MatchedSupplierRefreshOutcome = {
  target: MatchedSupplierRefreshTarget;
  refresh: Awaited<ReturnType<typeof refreshSingleSupplierProduct>>;
  marketplaceScan: Awaited<ReturnType<typeof handleMarketplaceScanJob>> | null;
  match: Awaited<ReturnType<typeof handleMatchProductsJob>> | null;
  profit: Awaited<ReturnType<typeof runProfitEngine>> | null;
  previewPreparedCandidateIds: string[];
};

type RefreshTargetRow = {
  supplierKey: string;
  supplierProductId: string;
  currentSnapshotId: string | null;
  candidateIds: string[] | null;
  shippingEstimates: unknown;
  rawPayload: unknown;
};

export async function getMatchedSupplierRefreshTargets(input?: {
  supplierKey?: string;
  supplierProductId?: string;
  limit?: number;
}): Promise<MatchedSupplierRefreshTarget[]> {
  const supplierKeyFilter =
    input?.supplierKey && String(input.supplierKey).trim()
      ? String(input.supplierKey).trim().toLowerCase()
      : null;
  const supplierProductIdFilter =
    input?.supplierProductId && String(input.supplierProductId).trim()
      ? String(input.supplierProductId).trim()
      : null;
  const limit = Math.max(1, Math.min(Number(input?.limit ?? 20), 100));

  const result = await db.execute<RefreshTargetRow>(sql`
    WITH refresh_targets AS (
      SELECT LOWER(pc.supplier_key) AS supplier_key, pc.supplier_product_id
      FROM profitable_candidates pc
      WHERE 1 = 1
        ${supplierKeyFilter ? sql`AND LOWER(pc.supplier_key) = ${supplierKeyFilter}` : sql``}
        ${supplierProductIdFilter ? sql`AND pc.supplier_product_id = ${supplierProductIdFilter}` : sql``}
      UNION
      SELECT LOWER(m.supplier_key) AS supplier_key, m.supplier_product_id
      FROM matches m
      WHERE UPPER(COALESCE(m.status, '')) = 'ACTIVE'
        ${supplierKeyFilter ? sql`AND LOWER(m.supplier_key) = ${supplierKeyFilter}` : sql``}
        ${supplierProductIdFilter ? sql`AND m.supplier_product_id = ${supplierProductIdFilter}` : sql``}
    )
    SELECT
      rt.supplier_key AS "supplierKey",
      rt.supplier_product_id AS "supplierProductId",
      (
        SELECT pr.id::text
        FROM products_raw pr
        WHERE LOWER(pr.supplier_key) = rt.supplier_key
          AND pr.supplier_product_id = rt.supplier_product_id
        ORDER BY pr.snapshot_ts DESC, pr.id DESC
        LIMIT 1
      ) AS "currentSnapshotId",
      (
        SELECT pr.shipping_estimates
        FROM products_raw pr
        WHERE LOWER(pr.supplier_key) = rt.supplier_key
          AND pr.supplier_product_id = rt.supplier_product_id
        ORDER BY pr.snapshot_ts DESC, pr.id DESC
        LIMIT 1
      ) AS "shippingEstimates",
      (
        SELECT pr.raw_payload
        FROM products_raw pr
        WHERE LOWER(pr.supplier_key) = rt.supplier_key
          AND pr.supplier_product_id = rt.supplier_product_id
        ORDER BY pr.snapshot_ts DESC, pr.id DESC
        LIMIT 1
      ) AS "rawPayload",
      COALESCE(
        ARRAY(
          SELECT DISTINCT pc.id::text
          FROM profitable_candidates pc
          WHERE LOWER(pc.supplier_key) = rt.supplier_key
            AND pc.supplier_product_id = rt.supplier_product_id
          ORDER BY pc.id::text
        ),
        ARRAY[]::text[]
      ) AS "candidateIds"
    FROM refresh_targets rt
    ORDER BY
      CASE
        WHEN rt.supplier_key IN ('cjdropshipping', 'cj dropshipping') THEN 0
        WHEN rt.supplier_key = 'temu' THEN 1
        WHEN rt.supplier_key = 'alibaba' THEN 2
        WHEN rt.supplier_key = 'aliexpress' THEN 3
        ELSE 4
      END,
      rt.supplier_key,
      rt.supplier_product_id
    LIMIT ${limit}
  `);

  const refreshSuccessRates = await getSupplierRefreshSuccessRateMap();

  return (result.rows ?? []).map((row) => ({
    supplierKey: String(row.supplierKey ?? "").trim().toLowerCase(),
    supplierProductId: String(row.supplierProductId ?? "").trim(),
    currentSnapshotId: row.currentSnapshotId ? String(row.currentSnapshotId) : null,
    candidateIds: Array.isArray(row.candidateIds) ? row.candidateIds.map((value) => String(value)) : [],
    shippingEstimates: row.shippingEstimates ?? null,
    rawPayload: row.rawPayload ?? null,
  })).sort((left, right) => {
    const intelligenceOrder = compareSupplierIntelligence(
      computeSupplierIntelligenceSignal({
        supplierKey: left.supplierKey,
        shippingEstimates: left.shippingEstimates,
        rawPayload: left.rawPayload,
        refreshSuccessRate: refreshSuccessRates.get(left.supplierKey) ?? null,
      }),
      computeSupplierIntelligenceSignal({
        supplierKey: right.supplierKey,
        shippingEstimates: right.shippingEstimates,
        rawPayload: right.rawPayload,
        refreshSuccessRate: refreshSuccessRates.get(right.supplierKey) ?? null,
      })
    );
    if (intelligenceOrder !== 0) return intelligenceOrder;
    return `${left.supplierKey}:${left.supplierProductId}`.localeCompare(
      `${right.supplierKey}:${right.supplierProductId}`
    );
  });
}

async function getApprovedCandidatesForSupplierProduct(input: {
  supplierKey: string;
  supplierProductId: string;
}): Promise<Array<{ candidateId: string; marketplaceKey: string }>> {
  const result = await db.execute<{ candidateId: string; marketplaceKey: string }>(sql`
    SELECT
      pc.id::text AS "candidateId",
      pc.marketplace_key AS "marketplaceKey"
    FROM profitable_candidates pc
    WHERE LOWER(pc.supplier_key) = ${String(input.supplierKey).trim().toLowerCase()}
      AND pc.supplier_product_id = ${String(input.supplierProductId).trim()}
      AND pc.decision_status = 'APPROVED'
    ORDER BY pc.calc_ts DESC, pc.id DESC
  `);

  return result.rows ?? [];
}

export async function refreshMatchedSupplierRows(input?: {
  supplierKey?: string;
  supplierProductId?: string;
  limit?: number;
  searchLimit?: number;
}): Promise<{
  targets: MatchedSupplierRefreshTarget[];
  outcomes: MatchedSupplierRefreshOutcome[];
}> {
  const targets = await getMatchedSupplierRefreshTargets({
    supplierKey: input?.supplierKey,
    supplierProductId: input?.supplierProductId,
    limit: input?.limit,
  });

  const outcomes: MatchedSupplierRefreshOutcome[] = [];

  for (const target of targets) {
    const refresh = await refreshSingleSupplierProduct({
      supplierKey: target.supplierKey,
      supplierProductId: target.supplierProductId,
      requireExactMatch: true,
      updateExisting: true,
      searchLimit: input?.searchLimit ?? 60,
    });

    let marketplaceScan: Awaited<ReturnType<typeof handleMarketplaceScanJob>> | null = null;
    let match: Awaited<ReturnType<typeof handleMatchProductsJob>> | null = null;
    let profit: Awaited<ReturnType<typeof runProfitEngine>> | null = null;
    const previewPreparedCandidateIds: string[] = [];

    if (refresh.refreshed && refresh.refreshedSnapshotId) {
      marketplaceScan = await handleMarketplaceScanJob({
        limit: 25,
        productRawId: refresh.refreshedSnapshotId,
        platform: "ebay",
      });
      match = await handleMatchProductsJob({
        limit: 25,
        productRawId: refresh.refreshedSnapshotId,
      });
      profit = await runProfitEngine({
        limit: 50,
        supplierKey: target.supplierKey,
        supplierProductId: target.supplierProductId,
      });

      const approvedCandidates = await getApprovedCandidatesForSupplierProduct({
        supplierKey: target.supplierKey,
        supplierProductId: target.supplierProductId,
      });
      for (const candidate of approvedCandidates) {
        try {
          const prepared = await prepareListingPreviewForCandidate(candidate.candidateId, {
            marketplace: "ebay",
            forceRefresh: true,
          });
          if (prepared.ok) {
            previewPreparedCandidateIds.push(candidate.candidateId);
          }
        } catch {
          // keep fail-closed behavior; preview prep is only attempted for APPROVED candidates
        }
      }
    }

    await writeAuditLog({
      actorType: "WORKER",
      actorId: "supplier:refresh",
      entityType: "SUPPLIER_PRODUCT",
      entityId: `${target.supplierKey}:${target.supplierProductId}`,
      eventType: "MATCHED_SUPPLIER_REFRESH_COMPLETED",
      details: {
        supplierKey: target.supplierKey,
        supplierProductId: target.supplierProductId,
        currentSnapshotId: target.currentSnapshotId,
        refreshedSnapshotId: refresh.refreshedSnapshotId,
        refreshMode: refresh.refreshMode,
        exactMatchFound: refresh.exactMatchFound,
        candidateIds: target.candidateIds,
        previewPreparedCandidateIds,
      },
    });

    outcomes.push({
      target,
      refresh,
      marketplaceScan,
      match,
      profit,
      previewPreparedCandidateIds,
    });
  }

  return {
    targets,
    outcomes,
  };
}
