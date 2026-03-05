import { Worker } from "bullmq";
import { ENGINE_QUEUE_NAME } from "../lib/queue";
import { getBullConnection } from "../lib/bullConnection";

type EngineJobData = {
  kind: "test";
  message?: string;
};

export function startEngineWorker() {
  const worker = new Worker<EngineJobData>(
    ENGINE_QUEUE_NAME,
    async (job) => {
      if (job.data?.kind === "test") {
        return {
          ok: true,
          echo: job.data?.message ?? null,
          jobId: job.id,
          at: new Date().toISOString(),
        };
      }
      return { ok: true, jobId: job.id, at: new Date().toISOString() };
    },
    {
      connection: getBullConnection(),
    }
  );

  worker.on("completed", (job) => {
    console.log(`[engine.worker] completed job ${job.id}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[engine.worker] failed job ${job?.id}`, err);
  });

  console.log("[engine.worker] started");
  return worker;
}

// Allow: `npm run worker:engine`
if (require.main === module) {
  startEngineWorker();
}
