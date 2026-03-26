import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type TrendCandidateRow = {
  id: string;
  candidate: string;
};

function normalizeRows<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

async function getTrendCandidatesOrderColumn(): Promise<"created_ts" | "created_at" | "id"> {
  const result = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trend_candidates'
      AND column_name IN ('created_ts', 'created_at')
  `);

  const rows = normalizeRows<{ column_name: string }>(result);
  const columnSet = new Set(rows.map((row) => String(row.column_name)));

  if (columnSet.has("created_ts")) return "created_ts";
  if (columnSet.has("created_at")) return "created_at";
  return "id";
}

export async function getTrendCandidates(limit = 50, input?: { staleFirst?: boolean }): Promise<TrendCandidateRow[]> {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  const orderBy = await getTrendCandidatesOrderColumn();
  const staleFirst = input?.staleFirst !== false;

  const rows = normalizeRows<{ id: string; candidate: string | null }>(
    await db.execute(
      sql.raw(`
        SELECT id::text AS id, candidate_value AS candidate
        FROM trend_candidates
        WHERE candidate_type = 'keyword'
          AND coalesce(trim(candidate_value), '') <> ''
        ORDER BY ${orderBy} ${staleFirst ? "ASC" : "DESC"} NULLS LAST, id DESC
        LIMIT ${safeLimit}
      `)
    )
  );

  return rows
    .map((row) => ({ id: String(row.id), candidate: String(row.candidate ?? "") }))
    .filter((row) => row.candidate.trim().length > 0);
}
