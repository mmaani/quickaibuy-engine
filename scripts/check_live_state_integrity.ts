import { loadRuntimeEnv } from "@/lib/runtimeEnv";
import { getListingIntegritySummary } from "@/lib/listings/integrity";

loadRuntimeEnv();

async function main() {
  const summary = await getListingIntegritySummary();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
