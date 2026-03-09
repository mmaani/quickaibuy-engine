import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

import { Worker } from "bullmq";
import { bullConnection } from "@/src/lib/bull";
import { JOBS } from "@/src/lib/jobNames";
import { BULL_PREFIX, ENGINE_QUEUE_NAME } from "@/src/lib/queue";
import { pool } from "@/lib/db";
import { log } from "@/lib/logger";

function nowIso() {
  return new Date().toISOString();
}

type RunStatus = "STARTED" | "SUCCEEDED" | "FAILED";

async function logRun(args: {
  status: RunStatus;
  jobName: string;
  jobId: string;
  durationMs?: number;
  error?: string | null;
  meta?: unknown;
}) {
  const { status, jobName, jobId, durationMs, error, meta } = args;

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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), CASE WHEN $9 THEN NOW() ELSE NULL END)
    `,
    [
      "engine.worker",
      jobName,
      jobId,
      status,
      durationMs ?? null,
      status === "SUCCEEDED",
      error ?? null,
      JSON.stringify(meta ?? {}),
      status !== "STARTED",
    ]
  );
}

async function handleScanSupplier(data: unknown) {
  const payload = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const source = String(payload.source ?? payload.supplierKey ?? "unknown");
  const supplierProductId = String(payload.supplierProductId ?? payload.externalId ?? payload.url ?? nowIso());
  const url = String(payload.url ?? "");

  if (!url) {
    throw new Error("SCAN_SUPPLIER requires payload.url");
  }

  const raw = {
    source,
    url,
    fetchedAt: nowIso(),
    note: "placeholder raw record (replace with real crawler output)",
  };

  await pool.query(
    `
      INSERT INTO products_raw (
        supplier_key,
        supplier_product_id,
        source_url,
        title,
        raw_payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [source, supplierProductId, url, String(payload.title ?? ""), JSON.stringify(raw)]
  );

  return { inserted: true, source, supplierProductId, url };
}

export async function main() {
  log("info", "worker.starting", {
    at: nowIso(),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasDatabaseUrlDirect: Boolean(process.env.DATABASE_URL_DIRECT),
    hasRedisUrl: Boolean(process.env.REDIS_URL),
  });

  const worker = new Worker(
    ENGINE_QUEUE_NAME,
    async (job) => {
      const started = Date.now();
      const jobId = String(job.id);

      log("info", "job.started", {
        jobId,
        jobName: job.name,
        data: job.data,
      });

      await logRun({
        status: "STARTED",
        jobName: job.name,
        jobId,
      });

      try {
        let result: unknown;

        switch (job.name) {
          case JOBS.SCAN_SUPPLIER:
            result = await handleScanSupplier(job.data);
            break;
          default:
            throw new Error(`Unhandled job name: ${job.name}`);
        }

        const durationMs = Date.now() - started;

        await logRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId,
          durationMs,
          meta: { result },
        });

        log("info", "job.succeeded", {
          jobId,
          jobName: job.name,
          durationMs,
          result,
        });

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const durationMs = Date.now() - started;

        await logRun({
          status: "FAILED",
          jobName: job.name,
          jobId,
          durationMs,
          error: message,
        });

        log("error", "job.failed", {
          jobId,
          jobName: job.name,
          durationMs,
          error: message,
        });

        throw error;
      }
    },
    {
      connection: bullConnection,
      concurrency: 5,
      prefix: BULL_PREFIX,
    }
  );

  worker.on("failed", (job, err) => {
    log("error", "worker.failed.event", {
      jobId: job?.id ? String(job.id) : null,
      jobName: job?.name ?? null,
      error: err?.message ?? String(err),
    });
  });

  worker.on("completed", (job) => {
    log("info", "worker.completed.event", {
      jobId: String(job.id),
      jobName: job.name,
    });
  });

  log("info", "worker.ready");
}

main().catch((error) => {
  log("error", "worker.fatal", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
