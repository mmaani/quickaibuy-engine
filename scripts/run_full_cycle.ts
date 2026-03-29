import { loadRuntimeEnv } from "@/lib/runtimeEnv";
import { runCanonicalFullCycle } from "@/lib/autonomousOps/fullCycle";
import { classifyRuntimeFailure } from "@/lib/operations/runtimeFailure";
import { getRuntimeDiagnostics } from "./lib/runtimeDiagnostics.mjs";

loadRuntimeEnv();

async function main() {
  const result = await runCanonicalFullCycle({
    actorId: "scripts/run_full_cycle.ts",
    actorType: "SYSTEM",
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  void (async () => {
    const runtime = await getRuntimeDiagnostics({ includeConnectivity: false }).catch(() => null);
    console.log(
      JSON.stringify(
        {
          ok: false,
          command: "pnpm ops:full-cycle",
          runtime,
          failure: classifyRuntimeFailure(error),
          error: error instanceof Error ? { message: error.message, stack: error.stack ?? null } : { message: String(error) },
        },
        null,
        2
      )
    );
    process.exit(1);
  })();
});
