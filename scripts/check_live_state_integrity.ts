import { loadRuntimeEnv } from "@/lib/runtimeEnv";
import { getListingIntegritySummary } from "@/lib/listings/integrity";
import { classifyRuntimeFailure } from "@/lib/operations/runtimeFailure";
import { getRuntimeDiagnostics } from "./lib/runtimeDiagnostics.mjs";

loadRuntimeEnv();

async function main() {
  const runtime = await getRuntimeDiagnostics({ includeConnectivity: false });

  try {
    const summary = await getListingIntegritySummary();
    console.log(
      JSON.stringify(
        {
          ok: true,
          command: "pnpm check:live-integrity",
          runtime,
          summary,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          command: "pnpm check:live-integrity",
          runtime,
          failure: classifyRuntimeFailure(error),
          error: error instanceof Error ? { message: error.message, stack: error.stack ?? null } : { message: String(error) },
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
