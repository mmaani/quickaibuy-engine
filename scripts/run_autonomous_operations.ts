import { loadRuntimeEnv } from "@/lib/runtimeEnv";
import { enqueueAutonomousOpsBackbone } from "@/lib/jobs/enqueueAutonomousOpsBackbone";

loadRuntimeEnv();

async function main() {
  const phaseArg = String(process.argv[2] ?? "full").trim().toLowerCase();
  const phase =
    phaseArg === "diagnostics_refresh" || phaseArg === "prepare" || phaseArg === "publish"
      ? phaseArg
      : "full";

  const job = await enqueueAutonomousOpsBackbone({
    phase,
    triggerSource: "control-plane",
    idempotencySuffix: `script-${Date.now()}`,
  });

  console.log(JSON.stringify({
    ok: true,
    enqueued: true,
    phase,
    jobId: String(job.id ?? ""),
    queue: "AUTONOMOUS_OPS_BACKBONE",
    triggerSource: "control-plane",
    note: "Run executes canonically in jobs.worker via control-plane-governed backbone.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
