import { Worker } from "bullmq";
import { bullConnection } from "../lib/bull";
import { JOB_NAMES } from "../lib/jobs/jobNames";
import { expandTrendSignal } from "../lib/trends/expandTrendSignal";
import { writeAuditLog } from "../lib/audit/writeAuditLog";

export const jobsWorker = new Worker(
  "jobs",
  async (job) => {
    switch (job.name) {
      case JOB_NAMES.TREND_EXPAND: {
        const trendSignalId = String(job.data?.trendSignalId ?? "").trim();

        if (!trendSignalId) {
          throw new Error("trend:expand missing trendSignalId");
        }

        const result = await expandTrendSignal(trendSignalId);

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.TREND_EXPAND,
          entityType: "TREND_SIGNAL",
          entityId: trendSignalId,
          eventType: "EXPANDED",
          details: {
            source: "trend-expansion",
            jobId: String(job.id ?? ""),
            normalizedKeyword: result.normalizedKeyword,
            region: result.region,
            generatedCount: result.generatedCount,
            insertedCount: result.insertedCount,
            candidates: result.candidates,
          },
        });

        return {
          ok: true,
          trendSignalId,
          generatedCount: result.generatedCount,
          insertedCount: result.insertedCount,
        };
      }

      default:
        throw new Error(`Unhandled job name: ${job.name}`);
    }
  },
  {
    connection: bullConnection,
    concurrency: 10,
  }
);
