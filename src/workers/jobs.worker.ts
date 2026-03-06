import { Worker } from "bullmq";
import { bullConnection } from "../lib/bull";
import { JOB_NAMES } from "../lib/jobs/jobNames";
import { expandTrendSignal } from "../lib/trends/expandTrendSignal";
import { writeAuditLog } from "../lib/audit/writeAuditLog";
import { discoverProductsForCandidate } from "../lib/products/discoverProducts";

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

      case JOB_NAMES.PRODUCT_DISCOVER: {
        const candidateId = String(job.data?.candidateId ?? "").trim();

        if (!candidateId) {
          throw new Error("product:discover missing candidateId");
        }

        const result = await discoverProductsForCandidate(candidateId);

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.PRODUCT_DISCOVER,
          entityType: "TREND_CANDIDATE",
          entityId: candidateId,
          eventType: "PRODUCTS_DISCOVERED",
          details: {
            source: "product-discover-stub",
            jobId: String(job.id ?? ""),
            keyword: result.keyword,
            insertedCount: result.insertedCount,
            markets: result.markets,
          },
        });

        return {
          ok: true,
          candidateId,
          insertedCount: result.insertedCount,
          markets: result.markets,
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
