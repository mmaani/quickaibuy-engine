import dotenv from "dotenv";

// Load local env FIRST (Codespaces/local dev)
dotenv.config({ path: ".env.local" });

import { Worker } from "bullmq";
import { bullConnection } from "@/src/lib/bull";
import { JOBS } from "@/src/lib/jobNames";
import { sql } from "@/src/db/client";

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
  await sql`
    INSERT INTO worker_runs (worker, job_name, job_id, status, duration_ms, error, meta, started_at, finished_at)
    VALUES (
      'engine.worker',
      ${jobName},
      ${jobId},
      ${status},
      ${durationMs ?? null},
      ${error ?? null},
      ${JSON.stringify(meta ?? {})},
      NOW(),
      CASE WHEN ${status} = 'STARTED' THEN NULL ELSE NOW() END
    )
  `;
}

async function handleScanSupplier(data: any) {
  const source = String(data?.source ?? "unknown");
  const url = String(data?.url ?? "");
  if (!url) throw new Error("SCAN_SUPPLIER requires payload.url");

  const raw = {
    source,
    url,
    fetchedAt: nowIso(),
    note: "placeholder raw record (replace with real crawler output)",
  };

  await sql`
    INSERT INTO products_raw (source, source_url, external_id, raw, fetched_at)
    VALUES (${source}, ${url}, ${null}, ${JSON.stringify(raw)}, NOW())
  `;

  return { inserted: true, source, url };
}

export async function main() {
  console.log(`[engine.worker] starting at ${nowIso()}`);
  console.log(`[engine.worker] env check`, {
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasDatabaseUrlDirect: Boolean(process.env.DATABASE_URL_DIRECT),
    hasRedisUrl: Boolean(process.env.REDIS_URL),
  });

  const worker = new Worker(
    "engine",
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
