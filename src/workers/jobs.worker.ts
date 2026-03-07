import { Worker } from "bullmq";
import { bullConnection } from "../lib/bull";
import { BULL_PREFIX, JOB_NAMES } from "../lib/jobNames";
import { JOBS_QUEUE_NAME, LEGACY_JOB_NAMES } from "../lib/jobs/jobNames";
import { expandTrendSignal } from "../lib/trends/expandTrendSignal";
import { matchSupplierProductsToMarketplaceListings } from "../lib/matching/productMatcher";
import { runSupplierDiscover } from "../lib/jobs/supplierDiscover";
import { handleMarketplaceScanJob } from "../lib/jobs/marketplaceScan";
import { writeAuditLog } from "../lib/audit/writeAuditLog";
import { runProfitEngine } from "../lib/profit/profitEngine";

export const jobsWorker = new Worker(
  JOBS_QUEUE_NAME,
  async (job) => {
    console.log("[jobs.worker] starting job", {
      id: String(job.id ?? ""),
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
          },
        });

        return {
          ok: true,
          trendSignalId,
          generatedCount: result.generatedCount,
          insertedCount: result.insertedCount,
        };
      }

      case JOB_NAMES.SUPPLIER_DISCOVER: {
        const limitPerKeyword = Number(job.data?.limitPerKeyword ?? 20);
        const result = await runSupplierDiscover(limitPerKeyword);

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.SUPPLIER_DISCOVER,
          entityType: "JOB",
          entityId: String(job.id ?? "supplier:discover"),
          eventType: "COMPLETED",
          details: {
            source: "supplier-discover",
            jobId: String(job.id ?? ""),
            limitPerKeyword,
            processedCandidates: result.processedCandidates,
            insertedCount: result.insertedCount,
            keywords: result.keywords,
            sources: result.sources,
          },
        });

        return result;
      }

      case JOB_NAMES.SCAN_MARKETPLACE_PRICE:
      case LEGACY_JOB_NAMES.SCAN_MARKETPLACE_PRICE: {
        const result = await handleMarketplaceScanJob({
          limit: Number(job.data?.limit ?? 100),
          productRawId: job.data?.productRawId
            ? String(job.data.productRawId).trim()
            : undefined,
          platform: (job.data?.platform ?? "all") as "amazon" | "ebay" | "all",
        });

        await writeAuditLog({
          actorType: "WORKER",
          actorId: String(job.name),
          entityType: "JOB",
          entityId: String(job.id ?? "marketplace-scan"),
          eventType: "COMPLETED",
          details: {
            source: "marketplace-scan",
            jobId: String(job.id ?? ""),
            limit: Number(job.data?.limit ?? 100),
            productRawId: job.data?.productRawId
              ? String(job.data.productRawId).trim()
              : null,
            platform: (job.data?.platform ?? "all"),
            result,
          },
        });

        return result;
      }

      case JOB_NAMES.MATCH_PRODUCT:
      case LEGACY_JOB_NAMES.MATCH_PRODUCT:
      case LEGACY_JOB_NAMES.PRODUCT_MATCH: {
        const result = await matchSupplierProductsToMarketplaceListings({
          supplierLimit: Number(job.data?.supplierLimit ?? 250),
          marketplaceLimit: Number(job.data?.marketplaceLimit ?? 1000),
          minConfidence: Number(job.data?.minConfidence ?? 0.75),
        });

        for (const match of result.accepted) {
          await writeAuditLog({
            actorType: "WORKER",
            actorId: String(job.name),
            entityType: "MATCH",
            entityId:
              match.matchId ||
              [
                match.supplierKey,
                match.supplierProductId,
                match.marketplaceKey,
                match.marketplaceListingId,
              ].join(":"),
            eventType: "ACCEPTED",
            details: {
              supplierKey: match.supplierKey,
              supplierProductId: match.supplierProductId,
              marketplaceKey: match.marketplaceKey,
              marketplaceListingId: match.marketplaceListingId,
              matchType: match.matchType,
              confidence: match.confidence,
              evidence: match.evidence,
              status: match.status,
              jobId: String(job.id ?? ""),
            },
          });
        }

        return {
          ok: true,
          scannedSuppliers: result.scannedSuppliers,
          scannedMarketplaceListings: result.scannedMarketplaceListings,
          evaluatedPairs: result.evaluatedPairs,
          acceptedCount: result.acceptedCount,
        };
      }

      case JOB_NAMES.EVAL_PROFIT: {
        const result = await runProfitEngine(Number(job.data?.limit ?? 500));

        await writeAuditLog({
          actorType: "WORKER",
          actorId: JOB_NAMES.EVAL_PROFIT,
          entityType: "PROFIT_ENGINE",
          entityId: String(job.id ?? "profit"),
          eventType: "COMPLETED",
          details: {
            scannedMatches: result.scannedMatches,
            profitable: result.profitable,
            jobId: String(job.id ?? ""),
          },
        });

        return result;
      }

      default: {
        const reason = `Unhandled job name: ${job.name}`;

        await writeAuditLog({
          actorType: "WORKER",
          actorId: "jobs.worker",
          entityType: "JOB",
          entityId: String(job.id ?? "unknown"),
          eventType: "SKIPPED",
          details: {
            reason,
            jobName: String(job.name ?? ""),
            jobData: job.data ?? null,
          },
        });

        console.warn("[jobs.worker] skipped unknown job", {
          id: String(job.id ?? ""),
          name: job.name,
          data: job.data,
        });

        return { ok: true, skipped: true, reason };
      }
    }
  },
  {
    connection: bullConnection,
    concurrency: 10,
    prefix: BULL_PREFIX,
  }
);

jobsWorker.on("completed", (job, result) => {
  console.log("[jobs.worker] completed job", {
    id: String(job?.id ?? ""),
    name: job?.name,
    result,
  });
});

jobsWorker.on("failed", (job, err) => {
  console.error("[jobs.worker] failed job", {
    id: String(job?.id ?? ""),
    name: job?.name,
    error: err?.message ?? String(err),
  });
});
