import { Worker, Queue } from "bullmq";
import { bullConnection } from "../lib/bull";
import { JOB_NAMES } from "../lib/jobNames";
import { expandTrendSignal } from "../lib/trends/expandTrendSignal";
import { writeAuditLog } from "../lib/audit/writeAuditLog";
import { discoverProductsForCandidate } from "../lib/products/discoverProducts";
import { runSupplierDiscover } from "../lib/jobs/supplierDiscover";
import { handleMarketplaceScanJob } from "../lib/jobs/marketplaceScan";
import { handleMatchProductsJob } from "../lib/jobs/matchProducts";
import { runProfitEngine } from "../lib/profit/profitEngine";

const jobsQueue = new Queue("jobs", { connection: bullConnection });

export const jobsWorker = new Worker(
  "jobs",
  async (job) => {
    console.log("[jobs.worker] starting job", {
      id: job.id,
      name: job.name,
      data: job.data,
    });

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

        console.log("[jobs.worker] completed job", {
          id: job.id,
          name: job.name,
          result: {
            ok: true,
            trendSignalId,
            generatedCount: result.generatedCount,
            insertedCount: result.insertedCount,
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

        console.log("[jobs.worker] completed job", {
          id: job.id,
          name: job.name,
          result,
        });

        return {
          ok: true,
          candidateId,
          insertedCount: result.insertedCount,
          markets: result.markets,
        };
      }

      case JOB_NAMES.SUPPLIER_DISCOVER: {
        const limitPerKeyword = Number(job.data?.limitPerKeyword ?? 20);
        const result = await runSupplierDiscover(limitPerKeyword);

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.SUPPLIER_DISCOVER,
          entityType: "TREND_CANDIDATE",
          entityId: "batch",
          eventType: "SUPPLIER_PRODUCTS_DISCOVERED",
          details: {
            source: "supplier-discover",
            jobId: String(job.id ?? ""),
            processedCandidates: result.processedCandidates,
            insertedCount: result.insertedCount,
            keywords: result.keywords,
            sources: result.sources,
          },
        });

        console.log("[jobs.worker] completed job", {
          id: job.id,
          name: job.name,
          result,
        });

        return {
          ok: true,
          ...result,
        };
      }

      case JOB_NAMES.SCAN_MARKETPLACE_PRICE: {
        const result = await handleMarketplaceScanJob({
          limit: Number(job.data?.limit ?? 100),
          productRawId: job.data?.productRawId ? String(job.data.productRawId).trim() : undefined,
          platform: (job.data?.platform ?? "all") as "amazon" | "ebay" | "all",
        });

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.SCAN_MARKETPLACE_PRICE,
          entityType: "MARKETPLACE_PRICE",
          entityId: String(job.data?.productRawId ?? "batch"),
          eventType: "MARKETPLACE_PRICES_SCANNED",
          details: {
            source: "trend-marketplace-scanner",
            jobId: String(job.id ?? ""),
            ...result,
          },
        });

        const nextJob = await jobsQueue.add(
          JOB_NAMES.MATCH_PRODUCT,
          {
            limit: Number(job.data?.limit ?? 100),
            productRawId: job.data?.productRawId ? String(job.data.productRawId).trim() : undefined,
          },
          {
            removeOnComplete: 1000,
            removeOnFail: 5000,
          }
        );

        console.log("[jobs.worker] enqueued follow-up", {
          fromJob: job.name,
          nextJobName: JOB_NAMES.MATCH_PRODUCT,
          nextJobId: nextJob.id,
        });

        console.log("[jobs.worker] completed job", {
          id: job.id,
          name: job.name,
          result,
        });

        return result;
      }

      case JOB_NAMES.MATCH_PRODUCT: {
        const result = await handleMatchProductsJob({
          limit: Number(job.data?.limit ?? 50),
          productRawId: job.data?.productRawId ? String(job.data.productRawId).trim() : undefined,
        });

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.MATCH_PRODUCT,
          entityType: "MATCH",
          entityId: String(job.data?.productRawId ?? "batch"),
          eventType: "PRODUCTS_MATCHED",
          details: {
            source: "ebay-match-engine",
            jobId: String(job.id ?? ""),
            ...result,
          },
        });

        const nextJob = await jobsQueue.add(
          JOB_NAMES.EVAL_PROFIT,
          { limit: Number(job.data?.limit ?? 50) },
          {
            removeOnComplete: 1000,
            removeOnFail: 5000,
          }
        );

        console.log("[jobs.worker] enqueued follow-up", {
          fromJob: job.name,
          nextJobName: JOB_NAMES.EVAL_PROFIT,
          nextJobId: nextJob.id,
        });

        console.log("[jobs.worker] completed job", {
          id: job.id,
          name: job.name,
          result,
        });

        return result;
      }

      case JOB_NAMES.EVAL_PROFIT: {
        const result = await runProfitEngine({
          limit: Number(job.data?.limit ?? 50),
        });

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.EVAL_PROFIT,
          entityType: "PROFITABLE_CANDIDATE",
          entityId: "batch",
          eventType: "PROFIT_EVALUATED",
          details: {
            source: "profit-engine",
            jobId: String(job.id ?? ""),
            ...result,
          },
        });

        console.log("[jobs.worker] completed job", {
          id: job.id,
          name: job.name,
          result,
        });

        return result;
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

jobsWorker.on("failed", (job, err) => {
  console.error("[jobs.worker] failed job", {
    id: job?.id,
    name: job?.name,
    error: err.message,
  });
});
