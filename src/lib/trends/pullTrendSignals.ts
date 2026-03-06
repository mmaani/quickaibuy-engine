// src/lib/trends/pullTrendSignals.ts
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { enqueueTrendExpand } from "@/lib/jobs/enqueueTrendExpand";

export async function pullAndEnqueueTrendExpansions(limit = 100) {
  const r = await db.execute(sql<{ id: string }>`
    SELECT id
    FROM trend_signals
    ORDER BY captured_ts DESC
    LIMIT ${limit}
  `);

  for (const row of r.rows ?? []) {
    await enqueueTrendExpand(String(row.id));
  }

  return r.rows?.length ?? 0;
}
