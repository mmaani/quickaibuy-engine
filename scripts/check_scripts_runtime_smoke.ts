import { execFile } from "node:child_process";
import { promisify } from "node:util";

type SmokeLevel = "required" | "advisory";
type SmokeStatus = "OK" | "WARN" | "FAILED";

type SmokeCheck = {
  id: string;
  command: string;
  timeoutMs: number;
  level: SmokeLevel;
  attempts?: number;
};

type SmokeResult = {
  id: string;
  command: string;
  level: SmokeLevel;
  status: SmokeStatus;
  exitCode: number | null;
  reason: string;
};

const execFileAsync = promisify(execFile);

const SMOKE_CHECKS: SmokeCheck[] = [
  {
    id: "env-status",
    command: "pnpm env:status",
    timeoutMs: 30_000,
    level: "required",
    attempts: 1,
  },
  {
    id: "db-status",
    command: "pnpm db:status",
    timeoutMs: 30_000,
    level: "required",
    attempts: 1,
  },
  {
    id: "mutation-safety",
    command: "pnpm check:mutation-safety",
    timeoutMs: 30_000,
    level: "required",
    attempts: 1,
  },
  {
    id: "queue-namespace",
    command: "pnpm diag:queue-namespace",
    timeoutMs: 30_000,
    level: "required",
    attempts: 1,
  },
  {
    id: "codespace-check",
    command: "NODE_ENV=production pnpm codespace:check",
    timeoutMs: 90_000,
    level: "required",
    attempts: 1,
  },
  {
    id: "runtime-diag",
    command: "pnpm runtime:diag -- --no-connectivity",
    timeoutMs: 30_000,
    level: "advisory",
    attempts: 1,
  },
];

function shorten(text: string, limit = 280): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 3)}...`;
}

function classifyReason(error: unknown): { exitCode: number | null; reason: string } {
  if (!error || typeof error !== "object") {
    return { exitCode: null, reason: "Unknown command failure" };
  }

  const exitCode =
    "code" in error && typeof error.code === "number"
      ? error.code
      : "code" in error && /^[0-9]+$/.test(String(error.code ?? ""))
        ? Number(error.code)
        : null;
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "Command failed";
  const detail = stderr.trim() || stdout.trim() || message;

  return {
    exitCode,
    reason: shorten(detail),
  };
}

async function runCheck(check: SmokeCheck): Promise<SmokeResult> {
  const attempts = Math.max(1, check.attempts ?? 1);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await execFileAsync("bash", ["-lc", check.command], {
        timeout: check.timeoutMs,
        env: process.env,
        maxBuffer: 1024 * 1024 * 8,
      });
      return {
        id: check.id,
        command: check.command,
        level: check.level,
        status: "OK",
        exitCode: 0,
        reason: attempt === 1 ? "Command completed successfully" : `Command completed successfully after retry ${attempt}/${attempts}`,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const { exitCode, reason } = classifyReason(lastError);
  return {
    id: check.id,
    command: check.command,
    level: check.level,
    status: check.level === "required" ? "FAILED" : "WARN",
    exitCode,
    reason: attempts > 1 ? `${reason} | attempts=${attempts}` : reason,
  };
}

async function main() {
  const results: SmokeResult[] = [];
  for (const check of SMOKE_CHECKS) {
    results.push(await runCheck(check));
  }

  const failed = results.filter((result) => result.status === "FAILED");
  const warned = results.filter((result) => result.status === "WARN");
  const status: SmokeStatus = failed.length > 0 ? "FAILED" : warned.length > 0 ? "WARN" : "OK";

  console.log(
    JSON.stringify(
      {
        title: "scripts runtime smoke",
        status,
        totals: {
          checks: results.length,
          ok: results.filter((result) => result.status === "OK").length,
          warn: warned.length,
          failed: failed.length,
        },
        results,
      },
      null,
      2
    )
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
