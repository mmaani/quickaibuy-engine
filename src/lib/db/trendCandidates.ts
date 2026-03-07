import { db } from "@/lib/db";
import { trendCandidates } from "@/db/schema";
import { desc } from "drizzle-orm";

export type TrendCandidateRow = {
  id: number;
  candidate: string;
};

export async function getTrendCandidates(limit = 50): Promise<TrendCandidateRow[]> {
  const rows = await db
    .select({
      id: trendCandidates.id,
      candidate: trendCandidates.candidate,
    })
    .from(trendCandidates)
    .orderBy(desc(trendCandidates.id))
    .limit(limit);

  return rows.filter((row) => String(row.candidate ?? "").trim().length > 0);
}