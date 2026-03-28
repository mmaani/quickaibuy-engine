#!/usr/bin/env node
import {
  assertDbClassification,
  getDbTargetContext,
  printDbTargetBanner,
} from "./lib/dbTarget.mjs";

const command = String(process.argv[2] ?? "status").trim().toLowerCase();

try {
  const context = getDbTargetContext();

  if (command === "status") {
    printDbTargetBanner(context);
    console.log(
      JSON.stringify(
        {
          ok: true,
          activeEnvFile: context.envPath,
          envSource: context.envSource,
          databaseUrlHost: context.databaseUrlHost,
          databaseUrlDirectHost: context.databaseUrlDirectHost,
          branchClassification: context.classification,
          mutationSafety: context.mutationSafety.classification,
        },
        null,
        2
      )
    );
  } else if (command === "assert-dev") {
    assertDbClassification("DEV", context);
  } else if (command === "assert-prod") {
    assertDbClassification("PROD", context);
  } else {
    throw new Error("Usage: node scripts/db_target_cli.mjs <status|assert-dev|assert-prod>");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
