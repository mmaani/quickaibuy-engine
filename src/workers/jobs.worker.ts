import { Worker } from "bullmq";
import { bullConnection } from "../lib/bull";
import { JOB_NAMES } from "../lib/jobNames";
import { expandTrendSignal } from "../lib/trends/expandTrendSignal";
import { writeAuditLog } from "../lib/audit/writeAuditLog";
import { discoverProductsForCandidate } from "../lib/products/discoverProducts";
import { runSupplierDiscover } from "../lib/jobs/supplierDiscover";
import { handleMarketplaceScanJob } from "../lib/jobs/marketplaceScan";

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
