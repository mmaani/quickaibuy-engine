import { Worker } from "bullmq";
import { connection } from "../lib/queue";

new Worker(
  "engine",
  async (job) => {
    console.log("✅ got job", job.name, job.data);
    return { ok: true };
  },
  { connection }
);

console.log("🟢 worker running");
