import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type SupplierRefreshTelemetry = {
  supplierKey: string;
  attempts: number;
  exactMatches: number;
  refreshSuccessRate: number;
  rateLimitEvents: number;
  exactMatchMisses: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function getSupplierRefreshTelemetry(days = 7): Promise<SupplierRefreshTelemetry[]> {
  const windowDays = Math.max(1, Math.min(Number(days) || 7, 30));
  const result = await db.execute<SupplierRefreshTelemetry>(sql`
    SELECT
      lower(details->>'supplierKey') AS "supplierKey",
      count(*)::int AS attempts,
      count(*) FILTER (WHERE coalesce((details->>'exactMatchFound')::boolean, false) = true)::int AS "exactMatches",
      round(
        (
          count(*) FILTER (WHERE coalesce((details->>'exactMatchFound')::boolean, false) = true)::numeric
          / nullif(count(*)::numeric, 0)
        )::numeric,
        4
      )::float8 AS "refreshSuccessRate",
      count(*) FILTER (
        WHERE coalesce(details->>'blockerReason', '') ILIKE '%429%'
           OR coalesce(details->>'refreshMode', '') = 'exact-match-not-found'
      )::int AS "rateLimitEvents",
      count(*) FILTER (WHERE coalesce(details->>'refreshMode', '') = 'exact-match-not-found')::int AS "exactMatchMisses"
    FROM audit_log
    WHERE event_type = 'SUPPLIER_PRODUCT_REFRESHED'
      AND event_ts >= NOW() - (${String(windowDays)} || ' days')::interval
      AND coalesce(details->>'supplierKey', '') <> ''
    GROUP BY 1
    ORDER BY attempts DESC, "supplierKey" ASC
  `);

  return (result.rows ?? []).map((row) => ({
    supplierKey: String(row.supplierKey ?? "").trim().toLowerCase(),
    attempts: Number(row.attempts ?? 0),
    exactMatches: Number(row.exactMatches ?? 0),
    refreshSuccessRate: round2(Number(row.refreshSuccessRate ?? 0)),
    rateLimitEvents: Number(row.rateLimitEvents ?? 0),
    exactMatchMisses: Number(row.exactMatchMisses ?? 0),
  }));
}

export async function getSupplierRefreshSuccessRateMap(days = 7): Promise<Map<string, number>> {
  const rows = await getSupplierRefreshTelemetry(days);
  return new Map(rows.map((row) => [row.supplierKey, row.refreshSuccessRate]));
}
