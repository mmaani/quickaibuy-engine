#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const mutationFilePattern =
  /^(apply_|backfill_|cleanup_|clear_|fix_|mutate_|run_.*migration.*)/;
const approvedGuardPatterns = [
  "assertMutationAllowed(",
  "require_mutation_preflight",
];

function scanScriptFiles() {
  const scriptsDir = "scripts";
  const failures = [];

  for (const name of fs.readdirSync(scriptsDir).sort()) {
    if (!mutationFilePattern.test(name)) continue;
    if (name === "check_mutation_safety.mjs") continue;

    const fullPath = path.join(scriptsDir, name);
    const raw = fs.readFileSync(fullPath, "utf8");
    const guarded = approvedGuardPatterns.some((pattern) => raw.includes(pattern));
    if (!guarded) {
      failures.push(`${fullPath}: missing shared mutation guard`);
    }
  }

  return failures;
}

function scanPackageScripts() {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const failures = [];
  const entries = Object.entries(pkg.scripts ?? {});

  for (const [name, command] of entries) {
    const lower = String(command).toLowerCase();
    const looksMutative =
      /(mutate|migrate|backfill|cleanup|apply_sql|promote|publish|reject|approve|recover|refresh|remove)/.test(
        lower
      );
    const hardcodesProdEnv = lower.includes(".env.prod") || lower.includes(".env.vercel");
    if (looksMutative && hardcodesProdEnv) {
      failures.push(`package.json script "${name}" exposes a prod-targeted mutation shortcut`);
    }
  }

  return failures;
}

const failures = [...scanScriptFiles(), ...scanPackageScripts()];

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
} else {
  console.log(JSON.stringify({ ok: true, checked: "mutation safety" }, null, 2));
}
