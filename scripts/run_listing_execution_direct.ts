import dotenv from "dotenv";
import { assertNonCanonicalScriptAccess } from "./lib/nonCanonicalSurfaceGuard";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  await assertNonCanonicalScriptAccess({
    scriptName: "run_listing_execution_direct.ts",
    blockedAction: "run_listing_execution_direct",
    canonicalAction: "pnpm ops:autonomous publish via control-plane-governed backbone",
    mutatesState: true,
  });

  const { runListingExecution } = await import("../src/workers/listingExecute.worker");

  const limit = Number(process.argv[2] || "10");
  const mode = String(process.argv[3] || "dry-run").trim().toLowerCase();
  const dryRun = mode !== "live";

  const result = await runListingExecution({
    limit,
    dailyCap: limit,
    marketplaceKey: "ebay",
    dryRun,
    actorId: "run_listing_execution_direct",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
