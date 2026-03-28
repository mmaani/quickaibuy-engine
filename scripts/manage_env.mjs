#!/usr/bin/env node
import { parseEnvFile, resolveRuntimeEnvPath, switchActiveEnv } from "./lib/envState.mjs";
import { getDbTargetContext } from "./lib/dbTarget.mjs";

function parseHost(connectionString) {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname || null;
  } catch {
    return null;
  }
}

function printStatus() {
  const context = getDbTargetContext();
  console.log(
    JSON.stringify(
      {
        ok: true,
        activeEnvFile: resolveRuntimeEnvPath(),
        envSource: context.envSource,
        databaseUrlHost: context.databaseUrlHost,
        databaseUrlDirectHost: context.databaseUrlDirectHost,
        hasDatabaseUrl: context.hasDatabaseUrl,
        hasDatabaseUrlDirect: context.hasDatabaseUrlDirect,
        branchClassification: context.classification,
        mutationSafety: context.mutationSafety.classification,
      },
      null,
      2
    )
  );
}

function switchEnv(target) {
  if (target === "prod" && String(process.env.ALLOW_PROD_ENV_SWITCH ?? "").trim() !== "true") {
    throw new Error(
      "Blocked: set ALLOW_PROD_ENV_SWITCH=true to switch active env to PROD."
    );
  }

  const source = switchActiveEnv(target);
  const values = parseEnvFile(".env");
  const dbHost = parseHost(values.DATABASE_URL) ?? "missing";

  console.log(`Active env switched to ${target.toUpperCase()}.`);
  console.log(`env source: ${source}`);
  console.log(`DATABASE_URL host: ${dbHost}`);
  if (target === "dev") {
    console.log("WARNING: active .env now targets DEV. Mutations affect DEV only.");
  } else {
    console.log("WARNING: active .env now targets PROD. Mutations affect PROD.");
  }
}

const command = String(process.argv[2] ?? "status").trim().toLowerCase();

try {
  if (command === "status") {
    printStatus();
  } else if (command === "dev" || command === "prod") {
    switchEnv(command);
  } else {
    throw new Error("Usage: node scripts/manage_env.mjs <status|dev|prod>");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
