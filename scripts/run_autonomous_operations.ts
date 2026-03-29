import { loadRuntimeEnv } from "@/lib/runtimeEnv";
import { runAutonomousOperations } from "@/lib/autonomousOps/backbone";

loadRuntimeEnv();

async function main() {
  const phaseArg = String(process.argv[2] ?? "full").trim().toLowerCase();
  const phase =
    phaseArg === "diagnostics_refresh" || phaseArg === "prepare" || phaseArg === "publish"
      ? phaseArg
      : "full";

  const result = await runAutonomousOperations({
    phase,
    actorId: "scripts/run_autonomous_operations.ts",
    actorType: "SYSTEM",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
