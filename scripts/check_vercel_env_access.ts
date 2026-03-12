import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { classifyError, printStructuredResults, type DiagnosticResult } from "./lib/runtimeDiagnostics";

dotenv.config({ path: ".env.local" });
dotenv.config();

function run(cmd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe" });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function detectPullFailure(stderr: string, stdout: string): DiagnosticResult {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  if (text.includes("not logged in") || text.includes("login")) {
    return {
      check: "Vercel env pull",
      status: "AUTH_FAILURE",
      reason: "Vercel CLI is not authenticated",
      nextStep: "Run `vercel login` and retry.",
      detail: `${stderr}\n${stdout}`.trim(),
    };
  }
  if (text.includes("linked") || text.includes("project") || text.includes("no existing credentials")) {
    return {
      check: "Vercel env pull",
      status: "CONFIG_MISSING",
      reason: "Vercel project is not linked",
      nextStep: "Run `vercel link` in this repository and retry.",
      detail: `${stderr}\n${stdout}`.trim(),
    };
  }

  const c = classifyError(new Error(`${stderr}\n${stdout}`.trim()));
  return {
    check: "Vercel env pull",
    status: c.status,
    reason: c.reason,
    nextStep: c.nextStep,
    detail: c.detail,
  };
}

async function main() {
  const environment = process.argv[2] || "production";
  const tmpFile = `.env.vercel.${environment}.preflight.tmp`;
  const checks: DiagnosticResult[] = [];

  const cli = run("vercel", ["--version"]);
  if (cli.status !== 0) {
    checks.push({
      check: "Vercel CLI",
      status: "CONFIG_MISSING",
      reason: "vercel CLI not found",
      nextStep: "Install Vercel CLI globally or use `pnpm dlx vercel`.",
      detail: `${cli.stderr}\n${cli.stdout}`.trim(),
    });
    printStructuredResults("vercel env access", checks);
    process.exit(1);
    return;
  }

  checks.push({
    check: "Vercel CLI",
    status: "OK",
    reason: (cli.stdout || "installed").trim(),
  });

  const whoami = run("vercel", ["whoami"]);
  if (whoami.status !== 0) {
    checks.push({
      check: "Vercel auth",
      status: "AUTH_FAILURE",
      reason: "Not logged in to Vercel",
      nextStep: "Run `vercel login` and retry.",
      detail: `${whoami.stderr}\n${whoami.stdout}`.trim(),
    });
    printStructuredResults("vercel env access", checks);
    process.exit(1);
    return;
  }

  checks.push({
    check: "Vercel auth",
    status: "OK",
    reason: whoami.stdout.trim() || "authenticated",
  });

  if (fs.existsSync(".vercel/project.json")) {
    checks.push({
      check: "Vercel project link",
      status: "OK",
      reason: ".vercel/project.json exists",
    });
  } else {
    checks.push({
      check: "Vercel project link",
      status: "CONFIG_MISSING",
      reason: "project is not linked",
      nextStep: "Run `vercel link` and retry.",
    });
  }

  const pull = run("vercel", ["env", "pull", tmpFile, "--environment", environment, "--yes"]);
  if (pull.status === 0) {
    checks.push({
      check: "Vercel env pull",
      status: "OK",
      reason: `Pulled ${environment} env successfully`,
    });
  } else {
    checks.push(detectPullFailure(pull.stderr, pull.stdout));
  }

  printStructuredResults("vercel env access", checks);

  try {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  } catch {}

  process.exit(checks.some((c) => c.status !== "OK") ? 1 : 0);
}

main().catch((error) => {
  const c = classifyError(error);
  printStructuredResults("vercel env access", [
    {
      check: "vercel helper execution",
      status: c.status,
      reason: c.reason,
      nextStep: c.nextStep,
      detail: c.detail,
    },
  ]);
  process.exit(1);
});
