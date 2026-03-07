import dotenv from "dotenv";

// Load local env FIRST (Codespaces/local dev)
dotenv.config({ path: ".env.local" });

import { Worker } from "bullmq";
import { bullConnection } from "@/src/lib/bull";
import { JOBS } from "@/src/lib/jobNames";
import { BULL_PREFIX, ENGINE_QUEUE_NAME } from "@/src/lib/queue";
import { pool } from "@/lib/db";

function nowIso() {
  return new Date().toISOString();
}

async function logRun(args: {
  status: "STARTED" | "SUCCEEDED" | "FAILED";
  jobName: string;
  jobId: string;
  durationMs?: number;
  error?: string | null;
  meta?: unknown;
}) {
  const { status, jobName, jobId, durationMs, error, meta } = args;
  await pool.query(
    `
      INSERT INTO audit_log (actor_type, actor_id, entity_type, entity_id, event_type, details)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      "worker",
      "engine.worker",
      "job",
      jobId,
      status,
      JSON.stringify({ jobName, durationMs: durationMs ?? null, error: error ?? null, meta: meta ?? {} }),
    ]
  );
}

async function handleScanSupplier(data: unknown) {
  const payload = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const source = String(payload.source ?? payload.supplierKey ?? "unknown");
  const supplierProductId = String(payload.supplierProductId ?? payload.externalId ?? payload.url ?? nowIso());
  const url = String(payload.url ?? "");
  if (!url) throw new Error("SCAN_SUPPLIER requires payload.url");

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
  console.log(`[engine.worker] starting at ${nowIso()}`);
  console.log(`[engine.worker] env check`, {
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasDatabaseUrlDirect: Boolean(process.env.DATABASE_URL_DIRECT),
    hasRedisUrl: Boolean(process.env.REDIS_URL),
  });

  const worker = new Worker(
    ENGINE_QUEUE_NAME,
    async (job) => {
      const started = Date.now();
      await logRun({ status: "STARTED", jobName: job.name, jobId: String(job.id) });

      try {
        let result: unknown;

        switch (job.name) {
          case JOBS.SCAN_SUPPLIER:
            result = await handleScanSupplier(job.data);
            break;

          default:
            throw new Error(`Unhandled job name: ${job.name}`);
        }

        await logRun({
          status: "SUCCEEDED",
          jobName: job.name,
          jobId: String(job.id),
          durationMs: Date.now() - started,
          meta: { result },
        });

        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);

        await logRun({
          status: "FAILED",
          jobName: job.name,
          jobId: String(job.id),
          durationMs: Date.now() - started,
          error: msg,
        });

        throw e;
      }
    },
    {
      connection: bullConnection,
      concurrency: 5,
      prefix: BULL_PREFIX,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[engine.worker] job failed`, { id: job?.id, name: job?.name, err: err?.message });
  });

  worker.on("completed", (job) => {
    console.log(`[engine.worker] job completed`, { id: job.id, name: job.name });
  });

  console.log(`[engine.worker] ready`);
}

main().catch((e) => {
  console.error("[engine.worker] fatal", e);
  process.exit(1);
});
