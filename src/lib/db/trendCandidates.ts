import { db } from "@/lib/db";
import { trendCandidates } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export type TrendCandidateRow = {
  id: string;
  candidate: string;
};

export async function getTrendCandidates(limit = 50): Promise<TrendCandidateRow[]> {
  const rows = await db
    .select({
      id: trendCandidates.id,
      candidate: trendCandidates.candidateValue,
    })
    .from(trendCandidates)
    .where(eq(trendCandidates.candidateType, "keyword"))
    .orderBy(desc(trendCandidates.createdTs))
    .limit(limit);

  return rows.filter((row) => String(row.candidate ?? "").trim().length > 0);
}
