#!/usr/bin/env node
import { assertMutationAllowed } from "./lib/mutationGuard.mjs";

const scriptName = String(process.argv[2] ?? "mutation-script").trim();
const requireDev = process.argv.includes("--require-dev");

try {
  assertMutationAllowed(scriptName, { requireDev });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
