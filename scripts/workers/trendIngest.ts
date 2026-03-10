import "dotenv/config";
import { makeWorker } from "@/lib/queue/bullmq";
import { db } from "@/lib/db";
import { auditLog, trendSignals, jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { TrendIngestJob } from "@/lib/jobs/types";

async function main() {
  makeWorker("trend-ingest", async (job) => {
    const payload = job.data as TrendIngestJob;

    await db
      .update(jobs)
      .set({ status: "RUNNING", startedTs: new Date(), lastError: null })
      .where(eq(jobs.idempotencyKey, String(job.id)));

    try {
      const inserted = await db
        .insert(trendSignals)
        .values({
          source: payload.source ?? "manual",
          signalType: payload.signalType ?? "keyword",
          signalValue: payload.signalValue,
          region: payload.region ?? null,
          score: payload.score != null ? String(payload.score) : null,
          rawPayload: payload.rawPayload ?? null,
        })
        .returning({ id: trendSignals.id });

      await db.insert(auditLog).values({
        actorType: "WORKER",
        actorId: "trend:ingest",
        entityType: "TREND_SIGNAL",
        entityId: String(inserted[0]?.id ?? ""),
        eventType: "CREATED",
        details: { jobId: job.id, payload },
      });

      await db
        .update(jobs)
        .set({ status: "SUCCEEDED", finishedTs: new Date(), lastError: null })
        .where(eq(jobs.idempotencyKey, String(job.id)));

      return { insertedId: inserted[0]?.id };
    } catch (error) {
      await db
        .update(jobs)
        .set({
          status: "FAILED",
          finishedTs: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
        })
        .where(eq(jobs.idempotencyKey, String(job.id)));

      throw error;
    }
  }, 5);

  console.log("trend:ingest worker started");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
