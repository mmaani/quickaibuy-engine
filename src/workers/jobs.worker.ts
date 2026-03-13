import { Worker, Queue } from "bullmq";
import { bullConnection } from "../lib/bull";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "../lib/jobNames";
import { expandTrendSignal } from "../lib/trends/expandTrendSignal";
import { writeAuditLog } from "../lib/audit/writeAuditLog";
import { discoverProductsForCandidate } from "../lib/products/discoverProducts";
import { runSupplierDiscover } from "../lib/jobs/supplierDiscover";
import { handleMarketplaceScanJob } from "../lib/jobs/marketplaceScan";
import { handleMatchProductsJob } from "../lib/jobs/matchProducts";
import { runProfitEngine } from "../lib/profit/profitEngine";
import { prepareListingPreviews } from "../lib/listings/prepareListingPreviews";
import { markJobFailed, markJobQueued, markJobRunning, markJobSucceeded } from "../lib/jobs/jobLedger";
import { pool } from "../lib/db";
import { runOrderSyncWorker } from "./orderSync.worker";
import { runInventoryRiskWorker } from "./inventoryRisk.worker";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, { connection: bullConnection, prefix: BULL_PREFIX });
console.log("[jobs.worker] booted and waiting for jobs");


async function logWorkerRun(args: {
  status: "STARTED" | "SUCCEEDED" | "FAILED";
  jobName: string;
  jobId: string;
  durationMs?: number;
  error?: string | null;
}) {
  await pool.query(
    `
      INSERT INTO worker_runs (
        worker,
        job_name,
        job_id,
        status,
        duration_ms,
        ok,
        error,
        stats,
        started_at,
        finished_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb, NOW(), CASE WHEN $8 THEN NOW() ELSE NULL END)
    `,
    [
      "jobs.worker",
      args.jobName,
      args.jobId,
      args.status,
      args.durationMs ?? null,
      args.status === "SUCCEEDED",
      args.error ?? null,
      args.status !== "STARTED",
    ]
  );
}

export const jobsWorker = new Worker(
  JOBS_QUEUE_NAME,
  async (job) => {
    const startedAtMs = Date.now();
    const idempotencyKey = String(job.id ?? `${job.name}-${Date.now()}`);
    const attempt = Number(job.attemptsMade ?? 0);
    const maxAttempts = Number(job.opts?.attempts ?? 1);

    await logWorkerRun({ status: "STARTED", jobName: job.name, jobId: idempotencyKey });

    await markJobRunning({
      jobType: job.name,
      idempotencyKey,
      payload: job.data,
      attempt,
      maxAttempts,
    });

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

        const output = {
          ok: true,
          trendSignalId,
          generatedCount: result.generatedCount,
          insertedCount: result.insertedCount,
        };

        await markJobSucceeded({ jobType: job.name, idempotencyKey, attempt, maxAttempts });
        await logWorkerRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: idempotencyKey,
          durationMs: Date.now() - startedAtMs,
        });

        return output;
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

        const output = {
          ok: true,
          candidateId,
          insertedCount: result.insertedCount,
          markets: result.markets,
        };

        await markJobSucceeded({ jobType: job.name, idempotencyKey, attempt, maxAttempts });
        await logWorkerRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: idempotencyKey,
          durationMs: Date.now() - startedAtMs,
        });

        return output;
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

        const output = {
          ok: true,
          ...result,
        };

        await markJobSucceeded({ jobType: job.name, idempotencyKey, attempt, maxAttempts });
        await logWorkerRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: idempotencyKey,
          durationMs: Date.now() - startedAtMs,
        });

        return output;
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

        await markJobQueued({
          jobType: JOB_NAMES.MATCH_PRODUCT,
          idempotencyKey: String(nextJob.id),
          payload: {
            limit: Number(job.data?.limit ?? 100),
            productRawId: job.data?.productRawId ? String(job.data.productRawId).trim() : undefined,
          },
          attempt: 0,
          maxAttempts: 1,
        });

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

        await markJobSucceeded({ jobType: job.name, idempotencyKey, attempt, maxAttempts });
        await logWorkerRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: idempotencyKey,
          durationMs: Date.now() - startedAtMs,
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

        await markJobQueued({
          jobType: JOB_NAMES.EVAL_PROFIT,
          idempotencyKey: String(nextJob.id),
          payload: { limit: Number(job.data?.limit ?? 50) },
          attempt: 0,
          maxAttempts: 1,
        });

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

        await markJobSucceeded({ jobType: job.name, idempotencyKey, attempt, maxAttempts });
        await logWorkerRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: idempotencyKey,
          durationMs: Date.now() - startedAtMs,
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

        await markJobSucceeded({ jobType: job.name, idempotencyKey, attempt, maxAttempts });
        await logWorkerRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: idempotencyKey,
          durationMs: Date.now() - startedAtMs,
        });

        return result;
      }

      case JOB_NAMES.LISTING_PREPARE: {
        const result = await prepareListingPreviews({
          limit: Number(job.data?.limit ?? 20),
          marketplace: (job.data?.marketplace ?? "ebay") as "ebay" | "amazon",
          forceRefresh: Boolean(job.data?.forceRefresh),
        });

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.LISTING_PREPARE,
          entityType: "LISTING",
          entityId: "batch",
          eventType: "LISTING_PREVIEWS_PREPARED",
          details: {
            source: "listing-readiness",
            jobId: String(job.id ?? ""),
            ...result,
          },
        });

        console.log("[jobs.worker] completed job", {
          id: job.id,
          name: job.name,
          result,
        });

        await markJobSucceeded({ jobType: job.name, idempotencyKey, attempt, maxAttempts });
        await logWorkerRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: idempotencyKey,
          durationMs: Date.now() - startedAtMs,
        });

        return result;
      }

      case JOB_NAMES.INVENTORY_RISK_SCAN: {
        const result = await runInventoryRiskWorker({
          limit: Number(job.data?.limit ?? 200),
          marketplaceKey: (job.data?.marketplaceKey ?? "ebay") as "ebay",
          actorId: JOB_NAMES.INVENTORY_RISK_SCAN,
        });

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.INVENTORY_RISK_SCAN,
          entityType: "LISTING",
          entityId: "batch",
          eventType: "INVENTORY_RISK_SCAN_COMPLETED",
          details: {
            source: "inventory-risk-monitor",
            jobId: String(job.id ?? ""),
            ...result,
          },
        });

        console.log("[jobs.worker] completed job", {
          id: job.id,
          name: job.name,
          result,
        });

        await markJobSucceeded({ jobType: job.name, idempotencyKey, attempt, maxAttempts });
        await logWorkerRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: idempotencyKey,
          durationMs: Date.now() - startedAtMs,
        });

        return result;
      }

      case JOB_NAMES.ORDER_SYNC: {
        const result = await runOrderSyncWorker({
          limit: Number(job.data?.limit ?? process.env.ORDER_SYNC_FETCH_LIMIT ?? 25),
          lookbackHours: Number(job.data?.lookbackHours ?? process.env.ORDER_SYNC_LOOKBACK_HOURS ?? 48),
          actorId: JOB_NAMES.ORDER_SYNC,
        });

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.ORDER_SYNC,
          entityType: "ORDER",
          entityId: "batch",
          eventType: "ORDER_SYNC_JOB_COMPLETED",
          details: {
            source: "order-sync-ebay",
            jobId: String(job.id ?? ""),
            ...result,
          },
        });

        console.log("[jobs.worker] completed job", {
          id: job.id,
          name: job.name,
          result,
        });

        await markJobSucceeded({ jobType: job.name, idempotencyKey, attempt, maxAttempts });
        await logWorkerRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: idempotencyKey,
          durationMs: Date.now() - startedAtMs,
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
    prefix: BULL_PREFIX,
  }
);

jobsWorker.on("failed", (job, err) => {
  if (job) {
    const failedJobId = String(job.id ?? `${job.name}-unknown`);
    void markJobFailed({
      jobType: job.name,
      idempotencyKey: failedJobId,
      attempt: Number(job.attemptsMade ?? 0),
      maxAttempts: Number(job.opts?.attempts ?? 1),
      lastError: err.message,
    });
    void logWorkerRun({
      status: "FAILED",
      jobName: job.name,
      jobId: failedJobId,
      error: err.message,
    });
  }

  console.error("[jobs.worker] failed job", {
    id: job?.id,
    name: job?.name,
    error: err.message,
  });
});
